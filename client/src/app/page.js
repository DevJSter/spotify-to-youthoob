"use client";
import { useState } from "react";

export default function SpotifyYouTubeConverter() {
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

  const handleConvert = async () => {
    try {
      setLoading(true);
      setError("");
      setVideos([]);

      // Log the request being made
      console.log("Making request to:", `${API_URL}/api/convert`);

      const response = await fetch(`${API_URL}/api/convert`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        mode: "cors",
        cache: "no-cache",
        credentials: "same-origin",
        body: JSON.stringify({ playlistUrl }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `HTTP error! status: ${response.status}`
        );
      }

      const data = await response.json();
      console.log("Received data:", data);
      setVideos(data.playlist || []);
    } catch (err) {
      console.error("Conversion error:", err);
      setError(err.message || "Failed to convert playlist");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto space-y-8 ">
        {/* Input Section */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="space-y-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">
                Spotify to YouTube Converter
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Enter a Spotify playlist URL to get YouTube equivalents
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
              <input
                type="text"
                placeholder="Paste Spotify playlist URL here"
                value={playlistUrl}
                onChange={(e) => setPlaylistUrl(e.target.value)}
                className={`flex-1 px-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  playlistUrl ? "text-black" : "text-gray-500"
                }`}
              />

              <button
                onClick={handleConvert}
                disabled={loading || !playlistUrl}
                className={`px-6 py-2 rounded-md text-white font-medium transition-colors
                  ${
                    loading || !playlistUrl
                      ? "bg-blue-300 cursor-not-allowed"
                      : "bg-blue-600 hover:bg-blue-700"
                  }`}
              >
                {loading ? (
                  <div className="flex items-center justify-center">
                    <svg
                      className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    Converting...
                  </div>
                ) : (
                  "Convert"
                )}
              </button>
            </div>

            {error && (
              <div className="p-4 bg-red-50 text-red-600 rounded-md text-sm">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Video Results */}
        {videos.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="space-y-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">
                  YouTube Videos
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Found {videos.length} matching videos
                </p>
              </div>

              <div className="space-y-8">
                {videos.map((video) => (
                  <div key={video.videoId} className="space-y-2">
                    <h3 className="font-medium text-gray-900">{video.title}</h3>
                    <div className="aspect-video w-full bg-gray-100 rounded-lg overflow-hidden">
                      <iframe
                        className="w-full h-full"
                        src={`https://www.youtube.com/embed/${video.videoId}`}
                        title={video.title}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
