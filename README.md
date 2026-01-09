# !ntro

Quickly find people’s introduction messages in Discord servers.

> [!NOTE]
> I am running my own instance of this bot you can invite to your servers and use freely. 
>
> Please report any bugs, oversights, issues, or suggestions to `@pixtelslinks` on discord.
>
> [invite link](https://discord.com/oauth2/authorize?client_id=1449356510843899997)

## Features

- Automatic message scraping.
- Multiple scraping modes: oldest, newest, longest, or a simple "smart" heuristic.
- Lookup by mention, username, or ID; use `me` to fetch your own intro.

## Setup (personal use)

1. Clone repository:

```bash
git clone https://github.com/pixtelslinks/intro-bot.git
cd intro-bot
```

2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file in the project root with your Discord token:

```env
DISCORD_TOKEN=discord-bot-token
```

4. Run the bot with pm2 (recommended for background processes):

```bash
npx pm2 start ecosystem.config.js
```

5. Stop the bot:

```bash
npx pm2 stop ecosystem.config.js
```

## Commands

### Configuration

These require the 'Manage Channels' privilege to use.

- Configure the bot (after inviting it to your server):

```text
!ntro config
```

- Add an intro channel by mention or ID:

```text
!ntro config channel [#channel|channelID]
```

- Set scraping mode:

```text
!ntro config mode [first|last|largest|smart]
```

Modes explained:
- `first` — choose each user’s oldest message in the configured channels.
- `last` — choose each user’s most recent message.
- `largest` — choose the longest message by character count.
- `smart` — prefer recent messages that are larger than the average (heuristic).

### Usage

- Look up any user by mention, username, or ID:

```text
!ntro @user
!ntro username
!ntro 123456789012345678
```

- To fetch your own intro, use:

```text
!ntro me
```

- To re-cache your intro:

```text
!ntro update
```

- To override your intro with a specific message:

```text
!ntro override message-link
```

- To clear your message override & re-cache:

```text
!ntro update force
```

- Update all messages in a server (requires privileges)

```text
!ntro update all
```

## Development

- After installing locally with the setup instructions, run the project:

```bash
npx nodemon --ignore '*.json'
```

## Contributing

PRs and issues are welcome. Keep changes focused and add tests where appropriate.