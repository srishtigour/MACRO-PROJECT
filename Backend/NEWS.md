# News layer

The backend reads RSS feeds listed in `news-sources.json`; these feeds do not require an API key. Add or remove a feed in that file to adjust the sources.

When the backend starts, it checks the feeds once and then checks again about every 15 minutes. The map displays today's collected stories and refreshes its news data every minute. The backend groups likely duplicate reports using shared district, timing, and headline/description words. It shows the clearest source-provided description and links to the publisher pages; it does not generate text with AI.

At 6:00 AM India time, the backend groups the previous day's articles into a digest. The digest appears under **Yesterday's digest**. Keep the backend process running for automatic collection and publication. On a deployed host, the JSON store in `.data/news-store.json` must be placed on persistent storage so data survives restarts and redeploys.
