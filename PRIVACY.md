# Privacy Policy for AskBeeves

**Last Updated:** January 7, 2026

AskBeeves ("the Extension") is designed with a "Privacy First" architecture. We do not collect, store, or transmit your personal data to any third-party servers.

## Data Collection & Storage

1.  **Local Storage**: All data generated or fetched by the Extension is stored locally on your device using the Chrome Storage API (`chrome.storage.local`).
2.  **Authentication**: The Extension reads your existing Bluesky session from your browser's local storage to authenticate requests to the Bluesky API. This session token is never sent anywhere except the official Bluesky API endpoints (`bsky.social`, `bsky.network`, etc.).
3.  **Social Graph Data**: The Extension fetches the public block lists of users you follow. This data is compressed into Bloom Filters and stored locally on your device.

## External Communications

The Extension **only** communicates with:

1.  **The Bluesky Network (AT Protocol)**: To fetch public profiles, follows, and block records.

The Extension **does NOT**:

1.  Use any analytics services (e.g., Google Analytics, Mixpanel).
2.  Send data to any developer-owned servers.
3.  Track your browsing history on other websites.

## Permissions

- **`storage`**: Required to save your preferences and the local cache of block lists.
- **`alarms`**: Required to periodically sync data in the background.
- **`host_permissions`** (`bsky.app`, `*.bsky.network`): Required to interact with the Bluesky web interface and API.

## Contact

For questions about this policy or the Extension, please open an issue on our GitHub repository:
https://github.com/proptermalone/askbeeves
