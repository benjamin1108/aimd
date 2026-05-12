export const WEB_CLIP_STYLE = `
    .aimd-clip-shell, .aimd-clip-shell * { box-sizing: border-box; }
    .aimd-clip-shell [hidden] { display: none !important; }
    .aimd-clip-shell { position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #15171c; letter-spacing: 0; }
    .aimd-clip-bar { position: fixed; z-index: 3; top: 18px; left: 50%; transform: translateX(-50%); width: min(760px, calc(100vw - 40px)); min-height: 48px; display: grid; grid-template-columns: minmax(180px, 1fr) auto auto; align-items: center; gap: 8px; padding: 7px; border: 1px solid rgba(255,255,255,.72); border-radius: 14px; background: linear-gradient(135deg, rgba(255,255,255,.9), rgba(245,247,250,.78)); box-shadow: 0 22px 62px rgba(19, 24, 36, .2), inset 0 1px 0 rgba(255,255,255,.86); backdrop-filter: blur(22px) saturate(1.18); pointer-events: auto; }
    .aimd-clip-bar::before { content: ""; position: absolute; inset: -1px; z-index: -1; border-radius: 15px; background: linear-gradient(120deg, rgba(22,163,255,.42), rgba(142,68,255,.34), rgba(255,68,165,.32), rgba(255,183,77,.28), rgba(22,163,255,.42)); background-size: 240% 240%; opacity: .72; filter: blur(10px); animation: aimdAura 6s ease-in-out infinite; pointer-events: none; }
    .aimd-clip-url { width: 100%; min-width: 0; border: 1px solid rgba(24, 27, 32, .14); border-radius: 9px; padding: 0 12px; color: #17191f !important; background: rgba(255,255,255,.94) !important; font: 520 13px/36px inherit; outline: none; box-shadow: inset 0 1px 0 rgba(255,255,255,.72); }
    .aimd-clip-url:focus { border-color: #2f343d; box-shadow: 0 0 0 3px rgba(24, 27, 32, .08); }
    .aimd-clip-btn { position: relative; isolation: isolate; overflow: hidden; height: 36px; border: 0 !important; border-radius: 9px; padding: 0 15px; background: #151822 !important; color: #fff !important; -webkit-text-fill-color: #fff !important; text-shadow: 0 1px 1px rgba(0,0,0,.24); font: 740 13px/36px inherit; cursor: pointer; white-space: nowrap; box-shadow: 0 10px 24px rgba(38, 47, 71, .28), inset 0 1px 0 rgba(255,255,255,.18); transition: transform .16s ease, filter .16s ease, opacity .16s ease; }
    .aimd-clip-btn:not(.secondary)::before { content: ""; position: absolute; inset: -2px; z-index: -2; border-radius: inherit; background: linear-gradient(110deg, #23d5ff 0%, #7b61ff 26%, #ff4fab 52%, #ffb457 76%, #23d5ff 100%); background-size: 260% 260%; animation: aimdAura 4.8s ease-in-out infinite; }
    .aimd-clip-btn:not(.secondary)::after { content: ""; position: absolute; inset: 1px; z-index: -1; border-radius: 8px; background: linear-gradient(180deg, rgba(27,31,43,.92), rgba(15,17,24,.94)); box-shadow: inset 0 1px 0 rgba(255,255,255,.18); }
    .aimd-clip-btn:hover { filter: brightness(1.06) saturate(1.08); }
    .aimd-clip-btn:active { transform: translateY(1px); }
    .aimd-clip-btn.secondary { background: #e9ecef !important; color: #30343b !important; -webkit-text-fill-color: #30343b !important; text-shadow: none; box-shadow: inset 0 1px 0 rgba(255,255,255,.72); }
    .aimd-clip-btn.secondary:hover { background: #dde1e5; }
    .aimd-clip-btn:disabled { opacity: .55; cursor: default; transform: none; }
    .aimd-clip-start, .aimd-clip-work, .aimd-clip-preview { position: fixed; z-index: 1; inset: 0; pointer-events: auto; }
    .aimd-clip-start { display: grid; align-items: center; padding: 56px clamp(24px, 7vw, 112px); background: radial-gradient(circle at 14% 18%, rgba(35,213,255,.18), transparent 34%), radial-gradient(circle at 78% 28%, rgba(255,79,171,.14), transparent 30%), radial-gradient(circle at 72% 82%, rgba(255,180,87,.14), transparent 34%), linear-gradient(180deg, #fafaf8 0%, #eff1ee 100%); }
    .aimd-clip-start::before { content: ""; position: absolute; inset: 0; opacity: .34; background-image: linear-gradient(rgba(23,25,31,.05) 1px, transparent 1px), linear-gradient(90deg, rgba(23,25,31,.05) 1px, transparent 1px); background-size: 34px 34px; pointer-events: none; }
    .aimd-clip-card { position: relative; width: min(760px, 100%); padding: 34px; border: 1px solid rgba(255,255,255,.74); border-radius: 16px; background: linear-gradient(145deg, rgba(255,255,255,.92), rgba(250,251,253,.84)); box-shadow: 0 30px 96px rgba(20, 23, 28, .15), inset 0 1px 0 rgba(255,255,255,.92); pointer-events: auto; backdrop-filter: blur(16px) saturate(1.12); }
    .aimd-clip-card::before { content: ""; position: absolute; inset: -1px; z-index: -1; border-radius: 17px; background: linear-gradient(130deg, rgba(35,213,255,.46), rgba(123,97,255,.25), rgba(255,79,171,.32), rgba(255,180,87,.28)); filter: blur(12px); opacity: .55; pointer-events: none; }
    .aimd-clip-card h1 { margin: 0 0 10px; font: 760 30px/1.15 inherit; color: #15171c; letter-spacing: 0; }
    .aimd-clip-card p { max-width: 560px; margin: 0 0 24px; color: #646a73; font: 450 14px/1.7 inherit; }
    .aimd-clip-home-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: end; }
    .aimd-clip-home-field { min-width: 0; }
    .aimd-clip-label { display: block; margin: 0 0 8px; color: #444a53; font: 680 12px/1.2 inherit; }
    .aimd-clip-home-form .aimd-clip-url { height: 46px; font-size: 15px; line-height: 46px; }
    .aimd-clip-home-form .aimd-clip-btn { height: 46px; min-width: 104px; line-height: 46px; }
    .aimd-clip-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; color: #6d737c; font: 520 12px/1.2 inherit; }
    .aimd-clip-meta span { border: 1px solid rgba(24, 27, 32, .1); border-radius: 999px; padding: 7px 10px; background: rgba(248,248,246,.8); }
    .aimd-clip-work { display: grid; place-items: center; padding: 32px; background: rgba(246,247,244,.96); backdrop-filter: blur(8px); }
    .aimd-clip-work-card { width: min(520px, 100%); border: 1px solid rgba(24,27,32,.12); border-radius: 14px; padding: 28px; background: #fff; box-shadow: 0 24px 80px rgba(20,23,28,.16); }
    .aimd-clip-skeleton { display: grid; gap: 10px; margin-bottom: 22px; }
    .aimd-clip-skeleton span { height: 12px; border-radius: 999px; background: linear-gradient(90deg, #ecefeb 0%, #f8f8f6 45%, #ecefeb 100%); background-size: 220% 100%; animation: aimdShimmer 1.4s ease-in-out infinite; }
    .aimd-clip-skeleton span:nth-child(1) { width: 72%; height: 16px; }
    .aimd-clip-skeleton span:nth-child(2) { width: 94%; }
    .aimd-clip-skeleton span:nth-child(3) { width: 82%; }
    .aimd-clip-work-text { color: #15171c; font: 720 16px/1.4 inherit; }
    .aimd-clip-work-sub { margin-top: 6px; color: #747a83; font: 13px/1.5 inherit; }
    .aimd-clip-preview { overflow: auto; padding: 88px 24px 32px; background: #f4f5f1; }
    .aimd-clip-preview-inner { width: min(920px, 100%); margin: 0 auto; padding: 34px 38px 52px; border: 1px solid rgba(24, 27, 32, .1); border-radius: 12px; background: #fff; color: #20242b; box-shadow: 0 24px 70px rgba(20,23,28,.12); }
    .aimd-clip-preview-inner h1 { font-size: 30px; line-height: 1.2; margin: 0 0 18px; }
    .aimd-clip-preview-inner h2 { font-size: 21px; margin: 28px 0 12px; }
    .aimd-clip-preview-inner h3 { font-size: 17px; margin: 22px 0 10px; }
    .aimd-clip-preview-inner p, .aimd-clip-preview-inner li { font-size: 15px; line-height: 1.75; }
    .aimd-clip-preview-inner img { max-width: 100%; height: auto; border-radius: 8px; }
    @media (max-width: 720px) {
      .aimd-clip-bar { top: 10px; width: calc(100vw - 20px); grid-template-columns: 1fr auto; }
      .aimd-clip-bar .aimd-clip-btn.secondary { display: none; }
      .aimd-clip-start { padding: 24px; }
      .aimd-clip-card { padding: 24px; }
      .aimd-clip-card h1 { font-size: 24px; }
      .aimd-clip-home-form { grid-template-columns: 1fr; }
      .aimd-clip-home-form .aimd-clip-btn { width: 100%; }
      .aimd-clip-preview-inner { padding: 26px 22px 40px; }
    }
    @keyframes aimdShimmer { 0% { background-position: 120% 0; } 100% { background-position: -120% 0; } }
    @keyframes aimdAura { 0%, 100% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } }
  `;
