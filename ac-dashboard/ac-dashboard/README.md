# AC Session Dashboard

Live dashboard for Assetto Corsa Content Manager session data.

## Setup

1. Make sure you have Node.js installed (https://nodejs.org)
2. Extract this folder somewhere on your PC
3. Open a terminal (PowerShell or Command Prompt) in the folder
4. Run:

```
node server.js
```

5. Open your browser to: http://localhost:3000

## That's it!

The dashboard will:
- Automatically load all sessions from your AC Sessions folder
- Watch the folder in real-time — new sessions appear instantly after a race
- Show the green "Live" indicator when connected

## Custom sessions path

If your AC Content Manager is installed in a non-default location, run:

```
set SESSIONS_PATH=C:\path\to\your\Sessions
node server.js
```

## Default path watched

```
C:\Users\<you>\AppData\Local\AcTools Content Manager\Progress\Sessions
```
