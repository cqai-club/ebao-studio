export const styles = `
.cqpm-shell{display:flex;width:100%;height:100%;min-width:0;min-height:0;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.cqpm-shell *{box-sizing:border-box}
.cqpm-nav{position:relative;display:flex;flex:none;flex-direction:column;gap:4px;width:184px;padding:max(60px,calc(28px + var(--dsh-frame-top-clearance,0px))) 12px 20px;border-right:1px solid var(--dsw-alias-border-l2)}
.cqpm-nav button{width:100%;padding:10px 14px;border:0;border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;text-align:left;cursor:pointer;-webkit-app-region:no-drag}
.cqpm-nav .cqpm-back{position:absolute;top:18px;left:16px;display:inline-flex;align-items:center;gap:6px;width:auto;min-height:24px;padding:2px 4px;color:var(--dsw-alias-label-primary);font-weight:500;line-height:20px}
.cqpm-nav button:hover,.cqpm-nav button[aria-current=page]{background:var(--dsw-alias-interactive-bg-hover)}
.cqpm-nav button[aria-current=page]{color:var(--dsw-alias-label-primary);font-weight:600}
.cqpm-nav button:focus-visible,.cqpm-market button:focus-visible,.cqpm-product button:focus-visible,.cqpm-product-pending button:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.cqpm-native{flex:1;min-width:0;min-height:0;height:100%;overflow:hidden}
.cqpm-native[hidden]{display:none}
.cqpm-market{flex:1;min-width:0;min-height:0;overflow:auto;padding:0 clamp(24px,4vw,48px) 48px}
.cqpm-market-head{max-width:960px;margin:0 auto 32px;padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.cqpm-market-head h1{margin:0;font-size:20px;font-weight:500;line-height:28px}
.cqpm-market-head p{margin:4px 0 0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.cqpm-message{max-width:960px;margin:0 auto;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.cqpm-product{min-width:0;margin:0 -8px;border-radius:var(--dsw-radius-xl,12px)}
.cqpm-product:hover,.cqpm-product:focus-within{background:var(--dsw-alias-interactive-bg-hover)}
.cqpm-product-head{display:flex;align-items:center;gap:14px;min-width:0;padding:8px}
.cqpm-product-icon{display:inline-flex;flex:none;align-items:center;justify-content:center;width:48px;height:48px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-lg,12px);color:var(--dsw-alias-label-secondary)}
.cqpm-product-icon img{width:36px;height:36px;object-fit:contain}
.cqpm-product-artwork{color:var(--dsw-alias-state-business-primary,#4b8df8)}
.cqpm-product-main{display:flex;flex:1;flex-direction:column;gap:4px;min-width:0}
.cqpm-product-title-line{display:flex;align-items:center;gap:8px;min-width:0}
.cqpm-product-title{min-width:0;max-width:100%;padding:0;border:0;background:transparent;color:inherit;font:inherit;font-size:14px;font-weight:500;line-height:20px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}
.cqpm-product-title:hover{text-decoration:underline}
.cqpm-product-description{margin:0;font-size:13px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cqpm-product-tag{flex:none;padding:2px 7px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4b7de5) 12%,transparent);color:var(--dsw-alias-brand-primary,#4b7de5);font-size:10px;line-height:14px}
.cqpm-product-tag-error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#d44) 10%,transparent);color:var(--dsw-alias-state-error-primary,#d44)}
.cqpm-product-switch{position:relative;flex:none;width:36px;height:20px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);cursor:pointer}
.cqpm-product-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}
.cqpm-product-switch span{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);transition:transform 120ms ease}
.cqpm-product-switch[aria-checked=true] span{transform:translateX(16px)}
.cqpm-product-switch:disabled{opacity:.5;cursor:default}
.cqpm-product-detail,.cqpm-product-message{margin:0;padding:8px 14px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.cqpm-product-error{color:var(--dsw-alias-state-error-primary,#d44)}
.cqpm-product-pending{display:flex;align-items:center;gap:10px;min-width:0;padding:12px 8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.cqpm-product-pending span{flex:1}
.cqpm-product-pending button{flex:none;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer}
.cqpm-product-pending button:last-child{border-color:transparent;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-label-primary-foreground)}
@media(max-width:700px){.cqpm-nav{width:150px}.cqpm-market{padding-left:20px;padding-right:20px}}
@media(max-width:520px){.cqpm-nav{width:120px;padding-left:6px;padding-right:6px}.cqpm-market{padding-left:14px;padding-right:14px}.cqpm-product-head{gap:10px}.cqpm-product-icon{width:40px;height:40px}.cqpm-product-icon img,.cqpm-product-artwork{width:30px;height:30px}}
`
