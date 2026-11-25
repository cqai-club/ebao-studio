# e宝工坊 Desktop artwork

The application icons restore the black e mark from the repository’s CQAI Desktop branding commit `dd1cfe64032963c411f3398dadf23b894521a195`. `app-macos.png`, `app-windows.png`, and `app-windows.ico` are byte-for-byte copies of `dsh-plugin-desktop/build/app-icon-mac.png`, `app-icon.png`, and `app-icon.ico` at that commit. The macOS image includes the original transparent inset. Both PNGs are 1024 × 1024.

`tray.ico` uses the alpha mask from that commit’s `dsh-plugin-desktop/src/client/assets/desktop-brand-mark.png` and the `#4D6BFE` color from `dsh-plugin-desktop/build/tray-icon.svg`. The ICO contains transparent PNG frames at 16, 20, 24, 32, 40, 48, and 64 pixels. Each frame scales the cropped mark to a square with approximately one pixel of inset per 16 pixels of edge length.

The installer artwork combines the e icon with the same commit’s `dsh-plugin-desktop/src/client/assets/desktop-brand-wordmark.png`. The wordmark is cropped to the product name and tinted for light and dark backgrounds. The brand canvases retain the pinned desktop installer’s 600 × 196 and 1200 × 392 sizes and white and `#151517` backgrounds. The side panel uses the e icon on the original 164 × 314 light gray canvas. The variants were rasterized with Pillow using Lanczos resampling and exported as uncompressed 24-bit RGB BMPs.
