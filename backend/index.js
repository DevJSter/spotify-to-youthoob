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
    try {
      await this.page.goto(
        `https://www.youtube.com/results?search_query=${encodeURIComponent(
          query
        )}`
      );
      await this.page.waitForSelector("#contents");

      await new Promise((resolve) => setTimeout(resolve, 2000));

      const content = await this.page.content();
      const $ = cheerio.load(content);

      const firstVideo = $("#contents ytd-video-renderer").first();
      const videoId = firstVideo.find("#thumbnail").attr("href");
      const title = firstVideo.find("#video-title").text().trim();

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
      console.error(`Error searching YouTube for ${query}:`, error);
      return null;
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

      // Wait for page load with timeout
      await this.page.goto(embedUrl, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });

      // Wait for the actual content to be visible
      await this.page.waitForSelector('[data-testid="track-list"]', {
        timeout: 10000,
      });

      // Scroll to load all content
      await this.page.evaluate(async () => {
        const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const container = document.querySelector('[data-testid="track-list"]');

        let previousHeight = 0;
        let currentHeight = container.scrollHeight;

        while (previousHeight !== currentHeight) {
          previousHeight = currentHeight;
          container.scrollTo(0, currentHeight);
          await delay(500);
          currentHeight = container.scrollHeight;
        }
      });

      // Get the content after all is loaded
      const textContent = await this.page.evaluate(
        () => document.body.innerText
      );

      return this.parsePlaylistContent(textContent);
    } catch (error) {
      console.error("Error scraping Spotify playlist:", error);
      return [];
    }
  }
  
  async createYouTubePlaylist(songs) {
    // Create chunks of songs for batch processing
    const chunkSize = 5; // Process 5 songs at a time
    const chunks = [];

    for (let i = 0; i < songs.length; i += chunkSize) {
      chunks.push(songs.slice(i, i + chunkSize));
    }

    const playlist = [];

    // Process each chunk in parallel while maintaining order
    for (const chunk of chunks) {
      const chunkPromises = chunk.map(async (song, index) => {
        console.log(`Searching for: ${song}`);
        const video = await this.searchYouTube(song);
        return {
          index,
          video,
        };
      });

      // Wait for all songs in the chunk to complete
      const chunkResults = await Promise.all(chunkPromises);

      // Sort by original index and add to playlist
      chunkResults
        .sort((a, b) => a.index - b.index)
        .forEach((result) => {
          if (result.video) {
            playlist.push(result.video);
          }
        });

      // Small delay between chunks to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
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

// API endpoint
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
    console.log(totalSongs);

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
