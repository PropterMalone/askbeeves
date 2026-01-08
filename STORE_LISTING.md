# AskBeeves - Store Listing

## Short Description (132 chars max)

See which users you follow block (or are blocked by) any Bluesky profile you view. Privacy-focused and runs locally.

## Detailed Description

AskBeeves helps you navigate the social graph on Bluesky by showing you the block relationships between your follows and the profile you are currently viewing.

**KNOW BEFORE YOU INTERACT**

When you visit a profile, AskBeeves quietly checks:

1. **Blocked By:** Which of your friends/follows have blocked this user?
2. **Blocking:** Which of your friends/follows are blocked BY this user?

This context helps you understand why your timeline might look different from others and helps you avoid interacting with bad actors that your community has already identified.

**FEATURES**

• **Instant Context:** See block counts right in the profile header.
• **Privacy First:** Uses Bloom Filters to store block lists efficiently (~3% size) and completely locally.
• **No Leaks:** No data is sent to third-party servers. All checks happen in your browser against public AT Protocol records.
• **Customizable:** Choose between "Compact" (text only) or "Detailed" (avatars) modes.

**HOW IT WORKS**

1. AskBeeves syncs your follows and their public block lists in the background.
2. It compresses this data into privacy-preserving Bloom Filters stored in your browser.
3. When you visit a profile, it checks the DID against these local filters.

**OPEN SOURCE**

AskBeeves is fully open source. You can audit the code and build it yourself:
https://github.com/proptermalone/askbeeves

---

## Category

Social & Communication

## Language

English

## Tags/Keywords

- bluesky
- block list
- safety
- social graph
- moderation
- privacy
