const express = require("express");
const cors = require("cors");
const puppeteer = require("puppeteer");
const cheerio = require("cheerio");

const app = express();


app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: "*" }));


// Additional CORS headers for extra compatibility
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.header("Access-Control-Allow-Credentials", true);
  next();
});

app.use(express.json());

class PlaylistScraper {
  constructor() {
    this.browser = null;
    this.page = null;
  }

  async initialize() {
    if (!this.browser) {
      this.browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-web-security"],
      });
      this.page = await this.browser.newPage();
    }
  }

  async searchYouTube(query) {
    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        // Create a new page for each search to avoid navigation conflicts
        const searchPage = await this.browser.newPage();

        await searchPage.setDefaultNavigationTimeout(30000);
        await searchPage.goto(
          `https://www.youtube.com/results?search_query=${encodeURIComponent(
            query
          )}`,
          { waitUntil: "networkidle0" }
        );

        await searchPage.waitForSelector("#contents");
        await new Promise((resolve) => setTimeout(resolve, 2000));

        const content = await searchPage.content();
        const $ = cheerio.load(content);

        const firstVideo = $("#contents ytd-video-renderer").first();
        const videoId = firstVideo.find("#thumbnail").attr("href");
        const title = firstVideo.find("#video-title").text().trim();

        // Close the search page
        await searchPage.close();

        if (videoId) {
          const videoIdMatch = videoId.match(/[?&]v=([^&]+)/);
          return {
            videoId: videoIdMatch ? videoIdMatch[1] : videoId.split("/").pop(),
            title,
            url: `https://youtube.com${videoId}`,
          };
        }
        return null;
      } catch (error) {
        retryCount++;
        console.error(`Attempt ${retryCount} failed for "${query}":`, error);

        // Wait longer between retries
        await new Promise((resolve) => setTimeout(resolve, 2000 * retryCount));

        if (retryCount === maxRetries) {
          console.error(`All attempts failed for "${query}"`);
          return null;
        }
      }
    }
  }

  parsePlaylistContent(content) {
    const songs = [];
    const lines = content.split("\n");

    let currentSong = null;
    let currentArtists = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (
        !line ||
        line === "Preview" ||
        line === "E" ||
        line === "Save on Spotify" ||
        line.match(/^\d+$/) ||
        line.match(/^\d{2}:\d{2}$/)
      ) {
        continue;
      }

      if (!currentSong) {
        currentSong = line;
      } else if (!currentArtists) {
        currentArtists = line;

        if (currentSong && currentArtists) {
          const uniqueArtists = [...new Set(currentArtists.split(", "))].join(
            ", "
          );
          songs.push(`${currentSong} - ${uniqueArtists}`);
          currentSong = null;
          currentArtists = null;
        }
      }
    }

    return songs;
  }

  async scrapeSpotifyPlaylist(playlistId) {
    try {
      const embedUrl = `https://open.spotify.com/embed/playlist/${playlistId}`;

      // Navigate with basic networkidle0 wait
      await this.page.goto(embedUrl, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });

      // Initial pause to let dynamic content load
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Check if any content has loaded
      const initialContent = await this.page.evaluate(
        () => document.body.innerText
      );
      if (!initialContent) {
        throw new Error("No content loaded");
      }

      // Additional wait if content is too short (might still be loading)
      if (initialContent.split("\n").length < 5) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      // Get final content
      const textContent = await this.page.evaluate(
        () => document.body.innerText
      );
      const songs = this.parsePlaylistContent(textContent);

      // Validate we got some songs
      if (!songs || songs.length === 0) {
        throw new Error("No songs found in playlist");
      }

      return songs;
    } catch (error) {
      console.error("Error scraping Spotify playlist:", error);
      return [];
    }
  }

  async createYouTubePlaylist(songs) {
    // Process in smaller chunks
    const chunkSize = 3; // Reduced from 5 to 3
    const chunks = [];

    for (let i = 0; i < songs.length; i += chunkSize) {
      chunks.push(songs.slice(i, i + chunkSize));
    }

    const playlist = [];

    for (const chunk of chunks) {
      const chunkPromises = chunk.map(async (song, index) => {
        console.log(`Searching for: ${song}`);
        const video = await this.searchYouTube(song);
        return {
          index,
          video,
        };
      });

      // Process chunk and wait longer between chunks
      const chunkResults = await Promise.all(chunkPromises);

      chunkResults
        .sort((a, b) => a.index - b.index)
        .forEach((result) => {
          if (result.video) {
            playlist.push(result.video);
          }
        });

      // Increased delay between chunks
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    return playlist;
  }
}

// Create a scraper instance
let scraper = null;

// Initialize scraper
async function initializeScraper() {
  if (!scraper) {
    scraper = new PlaylistScraper();
    await scraper.initialize();
  }
}

app.post("/api/convert", async (req, res) => {
  try {
    const { playlistUrl } = req.body;

    if (!playlistUrl) {
      return res.status(400).json({ error: "Playlist URL is required" });
    }

    await initializeScraper();

    const playlistId = playlistUrl.split("/playlist/")[1]?.split("?")[0];

    if (!playlistId) {
      return res.status(400).json({ error: "Invalid playlist URL" });
    }

    const songs = await scraper.scrapeSpotifyPlaylist(playlistId);
    const youtubePlaylist = await scraper.createYouTubePlaylist(songs);

    res.json({
      success: true,
      totalSongs: youtubePlaylist.length,
      playlist: youtubePlaylist,
    });
  } catch (error) {
    console.error("Conversion error:", error);
    res.status(500).json({ error: "Failed to convert playlist" });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  await initializeScraper();
  console.log(`Server running on port ${PORT}`);
});
