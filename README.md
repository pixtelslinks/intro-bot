# Intro Bot

Finding intros is a slog

!intro finds them faster

## Setup (for personal use)

If you want to run this as your own bot [you'll need to get a Discord bot token first](https://discord.com/developers/docs/quick-start/getting-started)

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file in the root directory and add your Discord bot token:
   ```env
   DISCORD_TOKEN=your-bot-token-here
   ```
   **Note:** Replace `your-bot-token-here` in `.env` with your actual Discord bot token.

3. Start the bot:
   ```bash
   npm start
   ```

## Usage
- After your bot joins your server, you'll want to configure it with `!intro config`

Add your server's intro channel
```
!intro config add {channel-id}
```

Configure your prefered scraping mode
- `first` finds the oldest message from each user
- `last` finds the most recent message from each user
- `largest` finds the largest message from each user by character length
- `smart` finds the most recent, but large enough message from each user

```
!intro config mode {first|last|largest|smart}
```

finally, find any user's intro message with a mention, username, or user ID
```
!intro @mention
```