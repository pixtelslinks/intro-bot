const { cache } = require("react");

// ecosystem.config.js
module.exports = {
    apps: [{
        name: "intro-bot",
        script: "index.js",
        watch: true,
        ignore_watch: ["node_modules", "configs.json", "intro-cache.json", ".git", "*.log"],
    }]
};