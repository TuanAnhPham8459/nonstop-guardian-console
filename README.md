# Nonstop Guardian Console

build an AI operations console for IT operatior monitoring a mission critical HPE NonStop banking system. This is a hackathon prototype using simulated data only. No real system access.Design: dark, professional operations-console look (not a generic chatbot). Three-panel layout:

Left: incident panel (title, severity badge, a running "minutes since first alert" timer, list of active alerts)

Center: assistant conversation where the operator types plain-language questions

Right: system status panel (8 CPUs shown as status tiles, transaction throughput, response time)

Use a persistent banner: "SIMULATED ENVIRONMENT. No production access." Use React, Tailwind, and clean monospace for commands. Do not build any AI logic yet. Use placeholder data.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://nonstop-guardian-console.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/9c9c9968-0291-481b-b2aa-d0e1e41bad94).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
