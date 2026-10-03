# dihi_v2
A more robust version of Do I Have It, better security and using a db instead of json

## Barcode lookup deployment

Camera scanning calls the `barcode-lookup` Supabase Edge Function to look up the scanned UPC/EAN and avoid the barcode provider's browser CORS restriction. Deploy it to the same Supabase project used by the app:

```sh
supabase functions deploy barcode-lookup --project-ref nxqrjmvghczeygvwzxsl
```

The function uses Supabase's default JWT verification, so callers must be signed in to the app. It uses UPCitemdb's no-signup trial endpoint, currently limited to 100 combined requests per day.
