# Cloud library setup (Cloudflare R2 + Worker)

The app can show every book and audiobook stored in an R2 bucket. A small Worker
(`worker.js` in this folder) sits in front of the bucket. It lists what's there,
streams files, and only answers to your access token.

- **Books** are downloaded and imported the first time they sync, so they work offline.
- **Audiobooks** stream; only their track lengths are read when they sync.
- New files in the bucket appear each time the app opens, or when you tap **Library → Sync now**.

## 1. Bucket layout

```
books/Dune.epub                     a book (.epub or .txt)
books/Dune.jpg                      optional cover (same name as the book)
audio/The Hobbit/01.mp3             one folder per audiobook, tracks in name order
audio/The Hobbit/02.mp3
audio/The Hobbit/cover.jpg          optional cover (any image in the folder)
audio/Project Hail Mary.m4b         a single-file audiobook also works
```

Number your tracks (`01`, `02` … or `1`, `2` … `10`). The app sorts them like a person would.

## 2. Make an access token

This is a password only you and the app know. Run this in PowerShell to make one, and keep it somewhere safe:

```powershell
-join ((48..57) + (65..90) + (97..122) | Get-Random -Count 40 | ForEach-Object { [char]$_ })
```

## 3. Create the Worker (dashboard, no install needed)

1. In dash.cloudflare.com, open **Compute (Workers) → Workers & Pages → Create → Create Worker** (start from "Hello World"). Name it `my-library`, then **Deploy**.
2. Click **Edit code**, delete everything, paste the contents of `worker.js`, then click **Deploy**.
3. Go to the Worker's **Settings → Bindings → Add → R2 bucket**:
   - Variable name: `BUCKET`
   - R2 bucket: `library`
4. Go to **Settings → Variables and Secrets → Add**:
   - Type: **Secret**
   - Name: `TOKEN`
   - Value: your token from step 2
5. Copy the Worker's address, e.g. `https://my-library.<your-subdomain>.workers.dev`.

To check that it works, open `https://my-library.<your-subdomain>.workers.dev/catalog?t=<your token>` in a browser. You should see a list of your books.

## 4. Connect the app

Open the app, tap the **archive button** (top right) to open **Library**, and find **Cloud library**. Enter the Worker address and your token, then tap **Sync now**.

## 5. Uploading big audiobooks (rclone)

The dashboard can't upload files over 300 MB, so use **rclone** for audiobooks. It splits big files into parts automatically.

1. Install it in PowerShell:
   ```powershell
   winget install Rclone.Rclone
   ```
   Then close and reopen PowerShell.
2. In the Cloudflare dashboard, open **R2 → Manage API tokens → Create API token**:
   - Permission: **Object Read & Write**
   - Bucket: **library**

   Copy the **Access Key ID**, the **Secret Access Key** and your **Account ID**. The Account ID is in the S3 endpoint `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
3. Run `rclone config`, then answer the prompts:
   - **n** for a new remote
   - Name: `r2`
   - Storage: **s3**
   - Provider: **Cloudflare**
   - Enter the access key and the secret key
   - Endpoint: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
   - Accept the defaults for everything else
4. Upload a whole audiobook folder:
   ```powershell
   rclone copy "D:\Audiobooks\The Hobbit" "r2:library/audio/The Hobbit" --progress --s3-chunk-size 64M
   ```
   Upload a whole shelf of books:
   ```powershell
   rclone copy "D:\Ebooks" "r2:library/books" --progress
   ```

## Notes

- **Costs:** R2's free tier covers 10 GB of storage, and downloads are always free. The Workers free tier allows 100,000 requests a day.
- **Deleting from the app:** removing a cloud item from your shelf leaves the file in the bucket, and the item won't come back on the next sync. **Library → Bring back deleted cloud items** undoes that.
- **Changing the token:** update the `TOKEN` secret in Cloudflare, then enter the new token in the app.
- **No APK rebuild needed:** the APK loads the GitHub Pages site, so pushing these files is enough.
