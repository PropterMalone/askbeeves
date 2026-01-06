# AskBeeves for Bluesky

A Chrome extension that shows you which users you follow block (or are blocked by) a Bluesky profile you're viewing.

## Features

- **Blocked By**: See which of your follows block the profile you're viewing
- **Blocking**: See which of your follows are blocked by the profile you're viewing
- **Space-efficient**: Uses bloom filters to store block lists in ~3% of the space of full arrays
- **Privacy-respecting**: All data stays local in your browser
- **Fast**: Block data is synced in the background and cached locally

## Installation

### From Release (Recommended)

1. Download the latest release `.zip` file from the [Releases page](../../releases)
2. Extract the zip file to a folder
3. Open Chrome and navigate to `chrome://extensions/`
4. Enable "Developer mode" (toggle in top right)
5. Click "Load unpacked"
6. Select the extracted folder

### Build from Source

```bash
# Clone the repository
git clone https://github.com/yourusername/askbeeves.git
cd askbeeves

# Install dependencies
npm install

# Build the extension
npm run build

# Load the dist/ folder in Chrome as an unpacked extension
```

## Usage

1. Install the extension
2. Navigate to [bsky.app](https://bsky.app) and log in
3. Visit any profile page
4. The extension will display blocking information below the profile header

### Display Modes

Right-click the extension icon and select "Options" to choose between:

- **Compact**: Single line summary (e.g., "Blocked by 3 people you follow")
- **Detailed**: Shows avatars and names of blocking users

## How It Works

1. When you log into Bluesky, the extension syncs your follows list
2. For each person you follow, it fetches their public block list
3. Block lists are stored as bloom filters (probabilistic data structures) for efficiency
4. When you view a profile, the extension checks if any of your follows block that profile
5. Bloom filter matches are verified on-demand when you click to see the full list

### Privacy

- All data is stored locally in your browser using Chrome's storage API
- No data is sent to any third-party servers
- The extension only accesses public Bluesky API endpoints
- Block lists are public information on the AT Protocol

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type check
npm run type-check

# Lint
npm run lint

# Format code
npm run format

# Build
npm run build
```

### Project Structure

```
askbeeves/
├── src/
│   ├── api.ts          # AT Protocol API helpers
│   ├── background.ts   # Service worker for syncing
│   ├── bloom.ts        # Bloom filter implementation
│   ├── content.ts      # Content script for profile pages
│   ├── options.ts      # Options page script
│   ├── storage.ts      # Chrome storage helpers
│   ├── types.ts        # TypeScript types
│   └── __tests__/      # Test files
├── dist/               # Built extension (load this in Chrome)
├── icons/              # Extension icons
└── manifest.json       # Extension manifest
```

## Technical Details

### Bloom Filters

The extension uses bloom filters to efficiently store block lists. A bloom filter is a probabilistic data structure that can tell you:
- **Definitely NOT in set** (no false negatives)
- **Probably in set** (small false positive rate, ~0.1%)

This allows storing thousands of block lists using only ~15 bits per blocked user, compared to storing full DID strings (~50+ bytes each).

### AT Protocol

The extension uses the public AT Protocol APIs:
- `app.bsky.graph.getFollows` - Get users someone follows
- `com.atproto.repo.listRecords` - Get block records from a user's PDS

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
