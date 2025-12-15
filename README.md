# !ntro

Finding intros is a slog

*!ntro* finds them faster

## Setup (for personal use)

If you want to run this as your own bot [you'll need to get a Discord bot token first](https://discord.com/developers/docs/quick-start/getting-started)

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file in the root directory and add your Discord bot token:
   ```env
   DISCORD_TOKEN={bot-token}
   ```
   **Note:** Replace `your-bot-token-here` in `.env` with your actual Discord bot token.

3. Start the bot:
   ```bash
   npx pm2 start
   ```
   This will run an instance of the bot in the background with pm2.

4. To stop the bot:
   ```
   npx pm2 stop ecosystem.config.js
   ```

## Usage
- After your bot joins your server, you'll want to configure it with `!intro config`

  **Note:** you can use `!ntro`, `!intro` or just pinging @!ntro interchangably

- Add your server's intro channel
  ```
  !ntro config add #channel
  ```
  This command also takes a channel ID as an argument.


- Configure your prefered scraping mode
  - `first` finds the oldest message from each user
  - `last` finds the most recent message from each user
  - `largest` finds the largest message from each user by character length
  - `smart` finds the most recent, but larger than average message from each user

  ```
  !intro config mode [first|last|largest|smart]
  ```

- Finally, find any user's intro message with a mention, username, or user ID
  ```
  !ntro @mention
  ```

  To get your own intro, just use `me`
  ```
  !ntro me
  ```