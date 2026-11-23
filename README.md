# PrivateDrive: Firebase push notifications

## Files

| File | Purpose | Where it goes |
|---|---|---|
| `index.html` | Updated app (OneSignal removed, Firebase added) | Your web root |
| `sw.js` | Service worker: FCM background push, click routing, caching | Web root, replaces the old `sw.js` |
| `push_tokens.sql` | Token table and RLS | Run in Supabase SQL editor |
| `supabase/functions/notify-share/index.ts` | Sends pushes | Supabase edge function |

Keep `manifest.webmanifest` and `icons/` next to `index.html` and `sw.js`.

## 1. Firebase console

1. Create a project, then add a **Web app** under Project settings.
2. Copy the `firebaseConfig` values into the three places marked `YOUR_...`:
   `index.html` (`FB_CONFIG` and `FB_VAPID`) and `sw.js` (`firebase.initializeApp`).
3. Under **Cloud Messaging → Web Push certificates**, generate a key pair. Paste the public key into `FB_VAPID`.
4. Under **Service accounts**, generate a new private key. Save it as `service-account.json`. Do not put it in the frontend.

## 2. Database

Run `push_tokens.sql` in the Supabase SQL editor.

## 3. Edge function

```bash
supabase secrets set FIREBASE_SERVICE_ACCOUNT="$(cat service-account.json)"
supabase secrets set WEBHOOK_SECRET="$(openssl rand -hex 24)"
supabase functions deploy notify-share --no-verify-jwt
```

## 4. Database webhooks

In **Database → Webhooks**, create two webhooks that both point to the `notify-share` edge function:

- Table `file_shares`, event `INSERT`
- Table `file_shares`, event `UPDATE`

Add a header `x-webhook-secret` with the same value you set in `WEBHOOK_SECRET`.

## 5. Deploy the web app

Upload `index.html`, `sw.js`, and the existing assets to your host. Push needs HTTPS, or `localhost` for testing.

Existing users need to sign out and back in, or tap **Settings → Enable Notifications** once, so their token is saved.

## Testing

1. Sign in on two devices or browsers with different accounts.
2. Enable notifications on the recipient's device.
3. Share a file from the first account to the second.
4. The recipient should get a push, even with the app closed.
5. Accept or decline it. The sender should get a push.

## Troubleshooting

- **No token saved:** check the browser console for `FCM token failed`. The usual cause is a wrong VAPID key or a `sw.js` that failed to load.
- **Permission was granted but no push arrives:** check `push_tokens` has a row for the user. Then check the function logs (`supabase functions logs notify-share`).
- **iPhone:** web push only works after the app is added to the Home Screen (iOS 16.4+). Enable notifications from inside the installed app.
- **Old OneSignal service worker still active:** unregister it in DevTools → Application → Service Workers, then reload.
- **Duplicate notifications:** the app shows a toast while open and a system notification when closed. That's intended. If you see two system notifications, make sure only one `sw.js` is registered.
