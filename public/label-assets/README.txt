Put label image assets in this folder so the LOT label can use fixed public paths.

Expected filenames:
- background.png
- logo.png
- qr-code.png

Public URLs:
- /label-assets/background.png
- /label-assets/logo.png
- /label-assets/qr-code.png

Current behavior:
- If logo.png is missing, the label falls back to /assets/logo.png.
- If qr-code.png is missing, the label falls back to a generated QR for the lot URL.
- If background.png is missing, the layered CSS texture still renders behind the cap-color fade.
