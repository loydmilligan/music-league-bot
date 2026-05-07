import 'dotenv/config';
import { createServer } from 'node:http';

async function main(): Promise<void> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    console.error(
      'Error: SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SPOTIFY_REDIRECT_URI must all be set in .env',
    );
    process.exit(1);
  }

  const scopes = [
    'playlist-modify-public',
    'playlist-modify-private',
    'playlist-read-private',
  ].join(' ');

  const authUrl = new URL('https://accounts.spotify.com/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', scopes);

  console.log('\nOpen this URL in your browser:\n');
  console.log(authUrl.toString());
  console.log('\nWaiting for Spotify callback on port 3888...\n');

  await new Promise<void>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      if (!req.url?.startsWith('/oauth/spotify/callback')) {
        res.writeHead(404);
        res.end();
        return;
      }

      const callbackUrl = new URL(req.url, 'http://localhost');
      const code = callbackUrl.searchParams.get('code');
      const error = callbackUrl.searchParams.get('error');

      if (error || !code) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(`OAuth error: ${error ?? 'missing code'}`);
        server.close();
        reject(new Error(`OAuth error: ${error ?? 'missing code'}`));
        return;
      }

      const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
      const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenRes.ok) {
        const text = await tokenRes.text();
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Token exchange failed. Check your terminal.');
        server.close();
        reject(new Error(`Token exchange failed: ${text}`));
        return;
      }

      const tokens = (await tokenRes.json()) as { refresh_token: string };

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        '<html><body style="font-family:sans-serif;padding:2rem"><h1>Authorised!</h1><p>You can close this tab and return to the terminal.</p></body></html>',
      );

      console.log('\nSuccess! Add this line to your .env file:\n');
      console.log(`SPOTIFY_REFRESH_TOKEN=${tokens.refresh_token}\n`);

      server.close();
      resolve();
    });

    server.listen(3888, '0.0.0.0', () => {
      console.log('Listening on 0.0.0.0:3888 (Cloudflare tunnel -> https://mlbot.mattmariani.com)\n');
    });
  });
}

main().catch((err: Error) => {
  console.error('Error:', err.message);
  process.exit(1);
});
