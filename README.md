# Locker

A password vault for social media accounts that only opens at a fixed time each day. It's meant for cutting down impulsive use of X and Reddit. You hand it the account passwords, and you can't get them back until the daily window, which defaults to 18:00 EAT.

It runs entirely in the browser. No server holds your secrets.

## Encryption design

**Daily window: drand time-lock encryption.** Each password is encrypted with [tlock](https://github.com/drand/tlock-js) to a future round of the League of Entropy's [drand](https://drand.love) randomness beacon (the `quicknet` chain). The key that decrypts it is the beacon signature for that round, and the signature doesn't exist until the network publishes it at the scheduled time. Before then, nobody can decrypt the ciphertext: not this app, not you with admin rights, and not anyone who copies the vault file. Changing the device clock doesn't help. Lock times are computed from the latest drand round, and the app takes the later of that and the device clock.

**Emergency path: a time-lock puzzle.** Each locked password also gets a Rivest–Shamir–Wagner puzzle sized to about 72 hours of sequential modular squaring on your fastest device. Squarings can't be run in parallel, so extra cores don't help. The app measures the speed of each device you lock from and sizes puzzles for the fastest one it has seen. A hand-optimised native solver could probably finish 2–3 times faster than the in-browser one (gmp-wasm). That's the weakest part of the design, and it's why the delay can't be set below 48 hours. Progress is saved, so the solver can be paused and resumed.

**Rotation.** After a window opens, the old password stays decryptable for good. So every window ends with a re-lock: the app has already generated the next password, you change the account to it, and the new one is locked to the following day's window. There are always at least 20 hours between a lock and the window it targets, even if you edit the schedule.

## Gaps you close yourself

The setup checklists cover these, but they come down to you:

- **Recovery paths.** Point X and Reddit at a new email address used for nothing else, remove phone numbers, and disconnect Google/Apple sign-in. That email's password is locked too, on the emergency path only.
- **Open sessions.** Log out of every session, including the phone apps, after each password change.
- **Clipboard and password managers.** Turn off Windows clipboard history, Apple Handoff (Universal Clipboard), and password saving in iCloud Keychain and the browser.
- **The re-lock.** Nothing stops you from skipping the re-lock, or from setting your own password during a window. The app nags but can't force it.
- **Platform support recovery and new accounts.** Both are out of scope.

## Using it

1. Open the site on the PC and run **Settings → Measure this device's speed**.
2. On the iPhone, open it in Safari and add it to the home screen. Use only the home-screen app from then on, because Safari tabs and home-screen apps keep separate storage.
3. Follow **Setup**: recovery email first, then X, then Reddit, then any 2FA backup codes.
4. Export the vault after each lock or re-lock and keep a copy somewhere (your main email, iCloud Drive). The file holds only time-locked ciphertext, so it's safe to store anywhere. Import it on the other device to sync.

Locking and unlocking need internet access to reach `api.drand.sh`.

## Development

```sh
npm install
npm run dev      # local dev server
npm test         # unit tests; test/drand.test.ts needs network access
npm run build
```

Pushing to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`.
