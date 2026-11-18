// Shared site nav behavior: two-level navigation (a short always-visible
// primary row + one full grouped menu, both desktop and mobile), plus
// active-link marking. Works with any page using the standard
// .nav > .navInner > .navLinks markup, with a .navToggle button
// (aria-controls pointing at the .navLinks id). See docs/site-navigation.md.
(function () {
  const ABOUT_PATH = '/about/';
  // The signed-in home of the site. / is the storefront for arrivals only.
  const HUB_PATH = '/home/';
  const JOURNEYS = Object.freeze([
    { label: 'Home', path: '/' }, { label: 'Play', path: '/play/' },
    { label: 'Earn', path: '/earn/' }, { label: 'Community', path: '/community-hub/' },
    { label: '$WinLEW', path: '/token/' }, { label: 'Proof', path: '/proof/' },
    { label: 'Build', path: '/build/' },
  ]);
  function journeyFor(here) {
    // The XL1 hub and arcade are places to take part (2026-10-24), so they sit under Play.
    if (/^\/(play|mole-hub|quiz|leaderboards|xl1)(\/|$)/.test(here)) return '/play/';
    if (/^\/(earn|faucet|hodl|contribute|bounties)(\/|$)/.test(here)) return '/earn/';
    if (/^\/(community-hub|community|events|governance|news|partners|contact|who-we-are)(\/|$)/.test(here)) return '/community-hub/';
    if (/^\/(token|whitepaper|links)(\/|$)/.test(here)) return '/token/';
    if (/^\/(proof|proof-of-value|transparency|burn|health|policies|verify|profile|giveaways)(\/|$)/.test(here)) return '/proof/';
    if (/^\/(build|modules|roadmap|ecosystem|xyo|discord-bots)(\/|$)/.test(here)) return '/build/';
    return '/';
  }
  const ROADMAP_PATH = '/roadmap/';
  const GOVERNANCE_PROPOSALS_PATH = '/governance/#proposals';
  const GOVERNANCE_VOTE_PATH = '/governance/#eligibility';
  const BURN_TIMELINE_PATH = '/burn/#timeline';
  const PLATFORM_METRICS = {
    quiz: {
      kindLabel: 'Points',
      iconText: '🧠',
      iconClass: 'walletIcon',
      tickerText: 'PTS',
      tickerClass: 'walletTicker',
      defaultAriaLabel: 'Your redeemable quiz points',
      defaultTitle: 'Redeemable quiz points',
    },
    faucet: {
      kindLabel: 'Claimed',
      iconText: '💧',
      iconClass: 'walletIcon',
      tickerText: 'LEW',
      tickerClass: 'walletTicker',
      defaultAriaLabel: 'Your confirmed faucet claimed total',
      defaultTitle: 'Your confirmed faucet claimed total',
    },
    moleHub: {
      kindLabel: 'Stored',
      iconText: '🎮',
      iconClass: 'walletIcon',
      tickerText: 'LEW',
      tickerClass: 'walletTicker',
      defaultAriaLabel: 'Your stored Mole Hub WinLEW',
      defaultTitle: 'Your stored Mole Hub WinLEW',
    },
  };

  const NAV_SETS = {
    home: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'mole-hub', label: 'Mole Hub', path: '/mole-hub/' },
      { id: 'quiz', label: 'Quiz', path: '/quiz/' },
      { id: 'faucet', label: 'Faucet', path: '/faucet/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    about: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'mole-hub', label: 'Mole Hub', path: '/mole-hub/' },
      { id: 'quiz', label: 'Quiz', path: '/quiz/' },
      { id: 'faucet', label: 'Faucet', path: '/faucet/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    quiz: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'quiz', label: 'Quiz', path: '/quiz/' },
      { id: 'leaderboards', label: 'Leaderboards', path: '/leaderboards/' },
      { id: 'faucet', label: 'Faucet', path: '/faucet/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    faucet: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'faucet', label: 'Faucet', path: '/faucet/' },
      { id: 'games', label: 'Games', path: '/mole-hub/' },
      { id: 'quiz', label: 'Quiz', path: '/quiz/' },
      { id: 'verify', label: 'Verify', path: '/verify/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    moleHub: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'mole-hub', label: 'Home', path: '/mole-hub/' },
      { id: 'quiz', label: 'Quiz', path: '/quiz/' },
      { id: 'faucet', label: 'Faucet', path: '/faucet/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    leaderboards: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'leaderboards', label: 'Leaderboards', path: '/leaderboards/' },
      { id: 'quiz', label: 'Quiz', path: '/quiz/' },
      { id: 'faucet', label: 'Faucet', path: '/faucet/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    verify: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'mole-hub', label: 'Mole Hub', path: '/mole-hub/' },
      { id: 'quiz', label: 'Quiz', path: '/quiz/' },
      { id: 'faucet', label: 'Faucet', path: '/faucet/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    governance: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'governance', label: 'Governance', path: '/governance/' },
      { id: 'proposals', label: 'Proposals', path: GOVERNANCE_PROPOSALS_PATH },
      { id: 'vote', label: 'Vote', path: GOVERNANCE_VOTE_PATH },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    burn: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'burn', label: 'Burn', path: '/burn/' },
      { id: 'transparency', label: 'Transparency', path: '/transparency/' },
      { id: 'timeline', label: 'Timeline', path: BURN_TIMELINE_PATH },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    transparency: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'transparency', label: 'Transparency', path: '/transparency/' },
      { id: 'giveaways', label: 'Giveaways', path: '/giveaways/' },
      { id: 'burn', label: 'Burn', path: '/burn/' },
      { id: 'governance', label: 'Governance', path: '/governance/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    giveaways: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'giveaways', label: 'Giveaways', path: '/giveaways/' },
      { id: 'transparency', label: 'Transparency', path: '/transparency/' },
      { id: 'burn', label: 'Burn', path: '/burn/' },
      { id: 'events', label: 'Events', path: '/events/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    events: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'events', label: 'Events', path: '/events/' },
      { id: 'mole-hub', label: 'Mole Hub', path: '/mole-hub/' },
      { id: 'quiz', label: 'Quiz', path: '/quiz/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    modules: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'modules', label: 'Modules', path: '/modules/' },
      { id: 'roadmap', label: 'Roadmap', path: ROADMAP_PATH },
      { id: 'governance', label: 'Governance', path: '/governance/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    roadmap: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'modules', label: 'Modules', path: '/modules/' },
      { id: 'roadmap', label: 'Roadmap', path: ROADMAP_PATH },
      { id: 'transparency', label: 'Transparency', path: '/transparency/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    health: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'health', label: 'Health', path: '/health/' },
      { id: 'transparency', label: 'Transparency', path: '/transparency/' },
      { id: 'verify', label: 'Verify', path: '/verify/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    whitepaper: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'whitepaper', label: 'Whitepaper', path: '/whitepaper/' },
      { id: 'transparency', label: 'Transparency', path: '/transparency/' },
      { id: 'governance', label: 'Governance', path: '/governance/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    sponsors: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'sponsors', label: 'Sponsors', path: '/partners/' },
      { id: 'events', label: 'Events', path: '/events/' },
      { id: 'transparency', label: 'Transparency', path: '/transparency/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    dashboard: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'dashboard', label: 'Dashboard', path: '/verify/profile.html' },
      { id: 'verify', label: 'Verify', path: '/verify/' },
      { id: 'governance', label: 'Governance', path: '/governance/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    bots: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'bots', label: 'Discord Bots', path: '/discord-bots/' },
      { id: 'modules', label: 'Modules', path: '/modules/' },
      { id: 'health', label: 'Health', path: '/health/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    forge: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'forge', label: 'Forge', path: '/winlew-forge/' },
      { id: 'modules', label: 'Modules', path: '/modules/' },
      { id: 'bots', label: 'Discord Bots', path: '/discord-bots/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    contribute: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'contribute', label: 'Contribute', path: '/contribute/' },
      { id: 'burn', label: 'Burn', path: '/burn/' },
      { id: 'transparency', label: 'Transparency', path: '/transparency/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    xyo: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'xyo', label: 'XYO', path: '/xyo/' },
      { id: 'whitepaper', label: 'Whitepaper', path: '/whitepaper/' },
      { id: 'transparency', label: 'Transparency', path: '/transparency/' },
      { id: 'partners', label: 'Partners', path: '/partners/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    bounties: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'bounties', label: 'Bounties', path: '/bounties/' },
      { id: 'quiz', label: 'Quiz', path: '/quiz/' },
      { id: 'faucet', label: 'Faucet', path: '/faucet/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    news: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'news', label: 'News', path: '/news/' },
      { id: 'transparency', label: 'Transparency', path: '/transparency/' },
      { id: 'burn', label: 'Burn', path: '/burn/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    whoWeAre: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'who-we-are', label: 'Who We Are', path: '/who-we-are/' },
      { id: 'transparency', label: 'Transparency', path: '/transparency/' },
      { id: 'whitepaper', label: 'Whitepaper', path: '/whitepaper/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    // Was reusing NAV_SETS.bots (copy-paste) — gave /policies/ its own
    // primary row so it stops highlighting "Discord Bots" as its own active
    // link. See docs/site-navigation.md's 2026-07 changelog entry.
    policies: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'policies', label: 'Policies', path: '/policies/' },
      { id: 'terms', label: 'Terms', path: '/discord-bots/terms.html' },
      { id: 'privacy', label: 'Privacy', path: '/discord-bots/privacy.html' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    links: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'links', label: 'Links', path: '/links/' },
      { id: 'who-we-are', label: 'Who We Are', path: '/who-we-are/' },
      { id: 'faucet', label: 'Faucet', path: '/faucet/' },
      { id: 'quiz', label: 'Quiz', path: '/quiz/' },
    ],
    contact: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'contact', label: 'Contact', path: '/contact/' },
      { id: 'who-we-are', label: 'Who We Are', path: '/who-we-are/' },
      { id: 'bots', label: 'Discord Bots', path: '/discord-bots/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    proofOfValue: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'proof-of-value', label: 'Proof of Value', path: '/proof-of-value/' },
      { id: 'quiz', label: 'Quiz', path: '/quiz/' },
      { id: 'faucet', label: 'Faucet', path: '/faucet/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
    merch: [
      { id: 'home', label: 'Hub', path: HUB_PATH },
      { id: 'mole-hub', label: 'Mole Hub', path: '/mole-hub/' },
      { id: 'faucet', label: 'Faucet', path: '/faucet/' },
      { id: 'about', label: 'About', path: ABOUT_PATH },
    ],
  };

  // 2026-08-11 — the primary nav pill used to be { label: 'Home', path: '/' } on
  // 25 of these configs. Two problems, and together they are why /home/ was
  // getting forgotten:
  //
  //   1. The brand logo ALREADY links to '/', so the pill was a duplicate of the
  //      thing sitting immediately to its left.
  //   2. It therefore spent the most valuable slot in the nav on a page the user
  //      could already reach, while /home/ — the 85 KB ecosystem hub that
  //      actually shows what has been built — appeared nowhere except one row of
  //      the mega-menu.
  //
  // The pill now points at /home/ and is labelled 'Hub', which is distinct from
  // the logo and matches the language the landing page already uses ("Enter the
  // Ecosystem Hub", and "Ecosystem Hub" in its footer). '/' stays reachable by
  // the logo, which is where people look for it.
  const PAGE_CONFIGS = [
    {
      // Public first-visit landing page / storefront (2026-07-27 rework) —
      // CA/buy/charts/stats/full ecosystem directory live here now.
      match: ['/'],
      nav: NAV_SETS.home,
      active: 'home',
      metric: 'wallet',
      subtitle: 'WELCOME • LEARN • BEGIN',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'image', src: '/images/avatars/winlew-logo-128.png', alt: 'WinLEW home icon' },
    },
    {
      // Returning-user ecosystem hub — the original "/" homepage content,
      // live at /home/. Kept as a distinct, real page (not a redirect).
      match: ['/home/'],
      nav: NAV_SETS.home,
      active: 'home',
      metric: 'wallet',
      subtitle: 'BUILD • MAP • EMPOWER',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'image', src: '/images/avatars/winlew-logo-128.png', alt: 'WinLEW home hub icon' },
    },
    {
      match: ['/about/'],
      nav: NAV_SETS.about,
      active: 'about',
      metric: 'wallet',
      subtitle: 'ABOUT • LEARN • EXPLORE',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'image', src: '/images/avatars/winlew-logo-128.png', alt: 'WinLEW about icon' },
    },
    {
      match: ['/quiz/'],
      nav: NAV_SETS.quiz,
      active: 'quiz',
      metric: 'points',
      platformMetric: PLATFORM_METRICS.quiz,
      subtitle: 'QUIZ • LEARN • WIN',
      accentRgb: '201,105,255',
      accentText: '#e2a2ff',
      icon: { type: 'image', src: '/images/page-icons/quiz.png', alt: 'WinLEW quiz icon' },
      arcade: true,
    },
    {
      match: ['/faucet/'],
      nav: NAV_SETS.faucet,
      active: 'faucet',
      metric: 'wallet',
      platformMetric: PLATFORM_METRICS.faucet,
      subtitle: 'FAUCET • CLAIM • WIN',
      accentRgb: '240,176,70',
      accentText: '#ffcf7a',
      icon: { type: 'image', src: '/images/page-icons/faucet.png', alt: 'WinLEW faucet icon' },
      arcade: true,
    },
    {
      match: ['/mole-hub/'],
      nav: NAV_SETS.moleHub,
      active: 'mole-hub',
      metric: 'wallet',
      platformMetric: PLATFORM_METRICS.moleHub,
      subtitle: 'ARCADE • PLAY • WIN',
      accentRgb: '214,168,102',
      accentText: '#ffcf7a',
      icon: { type: 'image', src: '/images/avatars/arcade-128.png', alt: 'WinLEW Mole Hub icon' },
      arcade: true,
    },
    {
      // The XL1 hub and arcade (2026-10-24). They render their own WinLEW XL1 frame
      // (/xl1/shared/shell.js) rather than this nav, but every menu route needs an identity.
      match: ['/xl1/', '/xl1/arcade/'],
      nav: NAV_SETS.moleHub,
      active: 'mole-hub',
      metric: 'wallet',
      platformMetric: PLATFORM_METRICS.moleHub,
      subtitle: 'XL1 • PLAY • EARN',
      accentRgb: '214,168,102',
      accentText: '#ffcf7a',
      icon: { type: 'image', src: '/images/avatars/arcade-128.png', alt: 'WinLEW XL1 Arcade icon' },
      arcade: true,
    },
    {
      match: ['/leaderboards/'],
      nav: NAV_SETS.leaderboards,
      active: 'leaderboards',
      metric: 'wallet',
      subtitle: 'LEADERBOARDS • RANK • PROVE',
      accentRgb: '201,105,255',
      accentText: '#e2a2ff',
      icon: { type: 'glyph', value: '🏆', alt: 'WinLEW leaderboards icon' },
    },
    {
      // Giveaway Records. Its own exact entry for the same reason /hodl/ and
      // /community/ have theirs — a nav route with no PAGE_CONFIGS match
      // silently inherits the storefront's identity, which has caught us twice.
      match: ['/giveaways/'],
      nav: NAV_SETS.giveaways,
      active: 'giveaways',
      metric: 'wallet',
      subtitle: 'PROMISED • PAID • PROVEN',
      accentRgb: '143,214,160',
      accentText: '#8fd6a0',
      icon: { type: 'glyph', value: '🎟️', alt: 'WinLEW giveaway records icon' },
    },
    {
      // HODL Rewards. Its own exact entry — a nav route with no PAGE_CONFIGS
      // match silently inherits the storefront's identity, which has caught us
      // twice now.
      match: ['/hodl/'],
      nav: NAV_SETS.verify,
      active: 'home',
      metric: 'wallet',
      subtitle: 'HODL • QUALIFY • TUESDAY',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'glyph', value: '🗓️', alt: 'WinLEW HODL Rewards icon' },
    },
    {
      // Its own identity, NOT folded into the /verify/ + /mole-link/ entry
      // below. That one is "verify / link / trust" — a journey you are partway
      // through. The registry is a thing you check, and a page with no exact
      // PAGE_CONFIGS entry silently inherits the storefront's identity, which
      // has caught us twice.
      match: ['/community/'],
      nav: NAV_SETS.verify,
      active: 'home',
      metric: 'wallet',
      subtitle: 'REGISTER • VERIFY • RECEIVE',
      accentRgb: '143,214,160',
      accentText: '#8fd6a0',
      icon: { type: 'glyph', value: '🎁', alt: 'WinLEW airdrop registry icon' },
    },
    {
      // /mole-link/ is the launcher that starts this same flow (Discord OAuth
      // for the Mole or Utility app); /verify/ is where the wallet signature
      // actually happens. Same identity, so the two read as one journey.
      match: ['/verify/', '/mole-link/'],
      nav: NAV_SETS.verify,
      active: 'home',
      metric: 'wallet',
      subtitle: 'VERIFY • LINK • TRUST',
      accentRgb: '95,184,230',
      accentText: '#8ad2ff',
      icon: { type: 'image', src: '/images/page-icons/verify.png', alt: 'WinLEW verify icon' },
    },
    {
      match: ['/verify/profile.html', '/profile/'],
      nav: NAV_SETS.dashboard,
      active: 'dashboard',
      metric: 'wallet',
      subtitle: 'DASHBOARD • TRACK • GROW',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'image', src: '/images/page-icons/dashboard.png', alt: 'WinLEW dashboard icon' },
    },
    {
      match: ['/governance/'],
      nav: NAV_SETS.governance,
      active: 'governance',
      metric: 'wallet',
      subtitle: 'GOVERNANCE • VOTE • SHAPE',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'image', src: '/images/page-icons/governance.png', alt: 'WinLEW governance icon' },
    },
    {
      match: ['/governance/proposal/'],
      nav: NAV_SETS.governance,
      active: 'proposals',
      metric: 'wallet',
      subtitle: 'PROPOSALS • REVIEW • VOTE',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'image', src: '/images/page-icons/governance.png', alt: 'WinLEW proposals icon' },
    },
    {
      match: ['/governance/submit/'],
      nav: NAV_SETS.governance,
      active: 'proposals',
      metric: 'wallet',
      subtitle: 'PROPOSALS • BUILD • SUBMIT',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'image', src: '/images/page-icons/governance-submit.png', alt: 'WinLEW proposals icon' },
    },
    {
      match: ['/burn/'],
      nav: NAV_SETS.burn,
      active: 'burn',
      metric: 'wallet',
      subtitle: 'BURN • VERIFY • TRUST',
      accentRgb: '230,126,74',
      accentText: '#ffb489',
      icon: { type: 'image', src: '/images/page-icons/burn.png', alt: 'WinLEW burn icon' },
    },
    {
      match: ['/transparency/'],
      nav: NAV_SETS.transparency,
      active: 'transparency',
      metric: 'wallet',
      subtitle: 'TRANSPARENCY • CHECK • TRUST',
      accentRgb: '78,205,185',
      accentText: '#8de5d5',
      icon: { type: 'image', src: '/images/page-icons/transparency.png', alt: 'WinLEW transparency icon' },
    },
    {
      match: ['/events/'],
      nav: NAV_SETS.events,
      active: 'events',
      metric: 'wallet',
      subtitle: 'EVENTS • JOIN • EARN',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'image', src: '/images/page-icons/events.png', alt: 'WinLEW events icon' },
    },
    {
      match: ['/modules/'],
      nav: NAV_SETS.modules,
      active: 'modules',
      metric: 'wallet',
      subtitle: 'MODULES • BUILD • GROW',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'image', src: '/images/page-icons/modules.png', alt: 'WinLEW modules icon' },
    },
    {
      // Matching is exact (see the /policies/ note above), so /modules/system/
      // has to be listed here or it falls back to PAGE_CONFIGS[0] and renders
      // the wrong nav entirely.
      match: [
        '/modules/games-trivia.html',
        '/modules/core-infrastructure.html',
        '/modules/community-ops.html',
        '/modules/proof-of-value-engine.html',
        '/modules/quests-progression.html',
        '/modules/utility-expansion.html',
        '/modules/system/',
      ],
      nav: NAV_SETS.modules,
      active: 'modules',
      metric: 'wallet',
      subtitle: 'MODULES • BUILD • GROW',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'image', src: '/images/page-icons/modules.png', alt: 'WinLEW modules icon' },
    },
    {
      match: ['/roadmap/'],
      nav: NAV_SETS.roadmap,
      active: 'roadmap',
      metric: 'wallet',
      subtitle: 'ROADMAP • BUILD • ADVANCE',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'image', src: '/images/page-icons/modules.png', alt: 'WinLEW roadmap icon' },
    },
    {
      match: ['/health/'],
      nav: NAV_SETS.health,
      active: 'health',
      metric: 'wallet',
      subtitle: 'HEALTH • CHECK • CONFIRM',
      accentRgb: '85,240,165',
      accentText: '#9df7c4',
      icon: { type: 'image', src: '/images/page-icons/health.png', alt: 'WinLEW health icon' },
    },
    {
      match: ['/whitepaper/'],
      nav: NAV_SETS.whitepaper,
      active: 'whitepaper',
      metric: 'wallet',
      subtitle: 'WHITEPAPER • READ • UNDERSTAND',
      accentRgb: '184,194,212',
      accentText: '#d7deea',
      icon: { type: 'image', src: '/images/page-icons/whitepaper.png', alt: 'WinLEW whitepaper icon' },
    },
    {
      match: ['/partners/', '/sponsors/'],
      nav: NAV_SETS.sponsors,
      active: 'sponsors',
      metric: 'wallet',
      subtitle: 'SPONSORS • SUPPORT • EMPOWER',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'image', src: '/images/page-icons/partners.png', alt: 'WinLEW sponsors icon' },
    },
    {
      match: ['/xyo/'],
      nav: NAV_SETS.xyo,
      active: 'xyo',
      metric: 'wallet',
      subtitle: 'XYO • BUILD • BELIEVE',
      accentRgb: '46,204,113',
      accentText: '#7ee6a8',
      icon: { type: 'glyph', value: '🧭', alt: 'WinLEW XYO ecosystem icon' },
    },
    {
      match: ['/discord-bots/'],
      nav: NAV_SETS.bots,
      active: 'bots',
      metric: 'wallet',
      subtitle: 'BOTS • CONNECT • OPERATE',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'image', src: '/images/page-icons/discord-bots.png', alt: 'WinLEW Discord bots icon' },
    },
    {
      // News: exact for the index, matchPrefix for every generated article at
      // /news/<slug>/. See getPageConfig() below for why the prefix exists.
      match: ['/news/'],
      matchPrefix: ['/news/'],
      nav: NAV_SETS.news,
      active: 'news',
      metric: 'wallet',
      subtitle: 'NEWS • RECORD • RECEIPTS',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'glyph', value: '📰', alt: 'WinLEW news icon' },
    },
    {
      // Matching is exact (`config.match.includes(here)`), not by prefix, so
      // every page under /policies/ has to be listed or it silently falls back
      // to PAGE_CONFIGS[0] and shows the wrong nav.
      match: ['/policies/', '/policies/abuse/'],
      nav: NAV_SETS.policies,
      active: 'policies',
      metric: 'wallet',
      subtitle: 'POLICIES • REVIEW • VERIFY',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'image', src: '/images/avatars/utility-bot-128.png', alt: 'WinLEW policies icon' },
    },
    {
      match: [
        '/discord-bots/terms.html',
        '/discord-bots/privacy.html',
        '/discord-bots/terms-watchdog.html',
        '/discord-bots/privacy-watchdog.html',
        '/discord-bots/terms-utility.html',
        '/discord-bots/privacy-utility.html',
        '/discord-bots/terms-mole.html',
        '/discord-bots/privacy-mole.html',
        '/discord-bots/terms-geohackers.html',
        '/discord-bots/privacy-geohackers.html',
        '/discord-bots/terms-geoagora.html',
        '/discord-bots/privacy-geoagora.html',
      ],
      nav: NAV_SETS.bots,
      active: 'bots',
      metric: 'wallet',
      subtitle: 'POLICIES • REVIEW • VERIFY',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'image', src: '/images/avatars/utility-bot-128.png', alt: 'WinLEW policy icon' },
    },
    {
      match: ['/winlew-forge/'],
      nav: NAV_SETS.forge,
      active: 'forge',
      metric: 'wallet',
      subtitle: 'FORGE • BUILD • CREATE',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'image', src: '/images/page-icons/winlew-forge.png', alt: 'WinLEW Forge icon' },
    },
    {
      match: ['/contribute/'],
      nav: NAV_SETS.contribute,
      active: 'contribute',
      metric: 'wallet',
      subtitle: 'CONTRIBUTE • GIVE • EARN CLOUT',
      accentRgb: '160,90,230',
      accentText: '#e2c8ff',
      icon: { type: 'glyph', value: '🤲', alt: 'WinLEW contribute icon' },
    },
    // Previously had no entry here at all — silently fell back to
    // PAGE_CONFIGS[0] (Home's identity/tagline/accent/primary row). Same
    // default amber every other undecorated page uses, not a new color.
    {
      match: ['/bounties/'],
      nav: NAV_SETS.bounties,
      active: 'bounties',
      metric: 'wallet',
      subtitle: 'BOUNTIES • EARN • COMPETE',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'glyph', value: '🎯', alt: 'WinLEW bounties icon' },
    },
    {
      match: ['/who-we-are/'],
      nav: NAV_SETS.whoWeAre,
      active: 'who-we-are',
      metric: 'wallet',
      subtitle: 'WHO WE ARE • TEAM • TRUST',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'glyph', value: '🧑‍🤝‍🧑', alt: 'WinLEW who we are icon' },
    },
    {
      match: ['/links/'],
      nav: NAV_SETS.links,
      active: 'links',
      metric: 'wallet',
      subtitle: 'LINKS • BUY • VERIFY',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'glyph', value: '🔗', alt: 'WinLEW links icon' },
    },
    {
      match: ['/contact/'],
      nav: NAV_SETS.contact,
      active: 'contact',
      metric: 'wallet',
      subtitle: 'CONTACT • ASK • REACH',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'glyph', value: '✉️', alt: 'WinLEW contact icon' },
    },
    {
      match: ['/proof-of-value/'],
      nav: NAV_SETS.proofOfValue,
      active: 'proof-of-value',
      metric: 'wallet',
      subtitle: 'PROOF OF VALUE • NOT WEALTH',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'glyph', value: '🏆', alt: 'WinLEW proof of value icon' },
    },
    {
      // 2026-08-30: the shop itself now lives at /merch/. It spent a month
      // staged at /merch/shop.html behind a "coming soon" teaser; that path is
      // kept as a redirect stub so the private links handed out in the meantime
      // still land somewhere real, and it stays matched here for the instant
      // before the redirect fires.
      match: ['/merch/', '/merch/shop.html'],
      nav: NAV_SETS.merch,
      active: 'merch',
      metric: 'wallet',
      subtitle: 'MERCH • DROPS • GEAR',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'glyph', value: '🛍️', alt: 'WinLEW merch icon' },
    },
    {
      // Deterrent page shown in place of an asset-folder's raw file listing
      // (2026-07-26) — not a destination anyone navigates to intentionally,
      // but still gets a correct nav identity rather than silently falling
      // back to Home's.
      // '/no-thank-you/promotions/' added 2026-08-05: it is a real nav entry
      // (NAV_GROUPS lists it) and matching here is EXACT, not by prefix, so the
      // parent's entry never covered it and it rendered as Home — the exact
      // fallback this entry's own note was written to prevent.
      match: ['/no-thank-you/', '/no-thank-you/promotions/'],
      nav: NAV_SETS.home,
      active: 'home',
      metric: 'wallet',
      subtitle: 'NOTHING TO SEE HERE',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'image', src: '/images/avatars/winlew-logo-128.png', alt: 'WinLEW icon' },
    },
    {
      // The seven ecosystem sister-project pages (2026-08-05). All seven are
      // listed in NAV_GROUPS, so they are reachable from every page on the
      // site, yet none had a PAGE_CONFIGS entry — verified in a real browser,
      // all seven rendered with PAGE_CONFIGS[0]: the storefront's
      // "WELCOME • LEARN • BEGIN" subtitle, its icon, and "Home" highlighted
      // as the active link, on a page that is not Home.
      //
      // 'active' is deliberately an id no pill in NAV_SETS.home carries. None
      // of the five primary pills IS this page, so the honest result is that
      // nothing highlights — better than pointing the highlight at Home, which
      // is what the fallback was doing.
      match: [
        '/ecosystem/geowallet/',
        '/ecosystem/geoagora/',
        '/ecosystem/geojustice/',
        '/ecosystem/geohackers/',
        '/ecosystem/geopresence/',
        '/ecosystem/geoproof/',
        '/ecosystem/ublock/',
      ],
      nav: NAV_SETS.home,
      active: 'ecosystem',
      metric: 'wallet',
      subtitle: 'ECOSYSTEM • BUILD • CONNECT',
      accentRgb: '214,168,102',
      accentText: '#f0c989',
      icon: { type: 'glyph', value: '🧭', alt: 'WinLEW ecosystem icon' },
    },
  ];

  // Site-wide IA (2026-07-25 refactor — see docs/site-navigation.md): 5
  // groups answering, in order, "What can I do? / Can I trust this? / How
  // can I help? / How is everything built? / What are the legal policies?"
  // — user-intent order, not internal project structure. This ONE array
  // drives the desktop mega-menu, the mobile panel, AND the footer (see
  // buildGroupedPanel() and buildSiteFooter() below) — editing it here is
  // the only change needed for all three surfaces to stay in sync.
  const NAV_GROUPS = [
    // GROUP ORDER — reversed 2026-08-11 at the owner's request.
    //
    // On 2026-07-28 this was deliberately changed the OTHER way, to lead with
    // START HERE, on the reasoning that a new visitor needs orientation before
    // they need a game. The owner has since watched it in use and concluded the
    // opposite: almost everyone arriving already knows what WinLEW is and came
    // to do something. This is a considered reversal, not drift — if it is ever
    // flipped back, that should be an equally deliberate decision.
    //
    // ── FIRST FOUR GROUPS REBUILT 2026-08-21 ────────────────────────────────
    //
    // The brief: the footer had grown by accretion — new links went into
    // whichever column had room, so LEARN & CONNECT had become a bin holding
    // education, company identity, community, wallet functionality, rewards and
    // legal all at once, eleven items deep. Link Wallet + Roles, Airdrop
    // Registry and HODL Rewards — three real ecosystem ACTIONS — sat at the
    // bottom of it, underneath About and Contact.
    //
    // Reorganised around what a visitor is trying to do, not around internal
    // vocabulary. Four intents, four columns: I want to DO something / I want
    // to understand WinLEW / I want to check whether this is legitimate / I
    // want to build or give something back.
    //
    // No link was removed, added or re-pointed: the same 30 destinations, in
    // different columns and a deliberate order. GOVERNANCE and everything after
    // it is untouched.
    {
      // Renamed from PLAY & PARTICIPATE. "Participate" described the games; it
      // did not describe the faucet, HODL Rewards or the airdrop registry that
      // now sit here, and earning is the through-line of all of them.
      //
      // Ordered as the actual journey rather than by importance alone:
      //   identity  — Dashboard, Verify Wallet, Link Wallet + Roles
      //   play      — Mole Hub, Quiz
      //   claim     — Faucet, HODL Rewards, Airdrop Registry
      //   standing  — Leaderboards
      //
      // Verify Wallet and Link Wallet + Roles are ADJACENT on purpose. They
      // sound like duplicates and are not: /verify/ is the tool ("Link your
      // wallet."), /mole-link/ is the explainer ("Verify your wallet. How to
      // verify. What verification unlocks."). Two steps of one journey, so they
      // sit together rather than being deduplicated into one.
      title: 'PLAY & EARN',
      items: [
        { label: 'Dashboard', path: '/verify/profile.html' },
        { label: 'Verify Wallet', path: '/verify/' },
        // Moved up from the bottom of LEARN & CONNECT. Verification is the one
        // action that unlocks roles, governance voting and holder recognition
        // — it has no business sitting below the legal fine print.
        { label: 'Link Wallet + Roles', path: '/mole-link/' },
        { label: 'The Mole Hub', path: '/mole-hub/' },
        // 2026-10-24: the XL1 Arcade pays real XL1 for play, and the XL1 hub is where
        // GeoHackers, the faucet and wallet verification on XL1 live. Neither was in the menu.
        { label: 'XL1 Arcade', path: '/xl1/arcade/' },
        { label: 'XL1 Hub', path: '/xl1/' },
        { label: 'Claimable Quiz', path: '/quiz/' },
        { label: '$WinLEW Faucet', path: '/faucet/' },
        // Both moved out of LEARN & CONNECT: a weekly reward allocation and an
        // airdrop registry are things you DO, not things you read about.
        { label: 'HODL Rewards', path: '/hodl/' },
        { label: 'Airdrop Registry', path: '/community/' },
        // Last because it reports on everything above it. "$WinLEW
        // Leaderboards" because the page is no longer just game scores — it now
        // carries Clout (contributions) and Governance (participation) too.
        { label: '$WinLEW Leaderboards', path: '/leaderboards/' },
      ],
    },
    {
      // NAME KEPT, 2026-08-21. It was the wrong name for what this column held
      // — wallet linking and rewards are not "learning" — but the fix for that
      // was moving those out, which is done. What remains genuinely is learn
      // (Hub, News, About, Who We Are, Proof of Value) and connect (Contact,
      // Discord Bots, Community Events). Renaming a now-accurate heading would
      // be novelty, and it keeps the house 'X & Y' pattern.
      //
      // Earlier history: first group by owner request on 2026-07-28
      // (orientation before participation, after people reported never finding
      // out who WinLEW is); renamed from 'START HERE' on 2026-08-11 once
      // PLAY moved above it, because 'START HERE' was then pointing at the
      // second group — telling people to start somewhere they had scrolled
      // past.
      title: 'LEARN & CONNECT',
      // A newcomer's reading path (2026-07-31, owner request): what this is →
      // who runs it → what taking part is worth → who to talk to → the legal
      // fine print last. Contact stays ABOVE Who We Are per the owner's
      // 2026-08-11 request: someone looking for a way to reach the project is
      // trying to DO something, someone reading Who We Are is browsing.
      items: [
        { label: 'Hub', path: HUB_PATH },
        // 'Links' lives in THIRD-PARTY LINKS (2026-08-11) as 'All external
        // links' — the same page, in the group people look in for it. Listing
        // it twice in one menu is duplication, not discoverability.
        { label: 'News', path: '/news/' },
        { label: 'About', path: ABOUT_PATH },
        { label: 'Contact', path: '/contact/' },
        { label: 'Who We Are', path: '/who-we-are/' },
        { label: 'Proof of Value', path: '/proof-of-value/' },
        { label: 'Discord Bots', path: '/discord-bots/' },
        // Moved in from EXPLORE & BUILD. Quiz tournaments, AMAs and giveaways
        // are community, not construction — it was filed under "build" only
        // because it had been moved out of PLAY and needed somewhere to go.
        { label: 'Community Events', path: '/events/' },
        { label: 'Terms / Policies', path: '/policies/' },
      ],
    },
    {
      // Ordered as an investigation, most-load-bearing first: what is
      // provably true (Transparency Center) → what was promised (Whitepaper) →
      // what was destroyed (Burn) → what was actually paid (Giveaway Records) →
      // what we refuse to do (No Paid Promotion) → whether it is up right now
      // (Health). Operational status is last because it is the only item here
      // that answers "is it working", not "is it honest".
      title: 'TRUST & TRANSPARENCY',
      items: [
        { label: 'Transparency Center', path: '/transparency/' },
        { label: 'Whitepaper', path: '/whitepaper/' },
        { label: 'Burn Center', path: '/burn/' },
        { label: 'Giveaway Records', path: '/giveaways/' },
        // Moved in from EXPLORE & BUILD. "WinLEW does not pay KOLs,
        // influencers, callers or promoters" is a stated integrity commitment
        // — it is evidence for someone deciding whether to trust the project,
        // and it was filed under "explore".
        { label: 'No Paid Promotion', path: '/no-thank-you/promotions/' },
        { label: 'Health / Status', path: '/health/' },
      ],
    },
    {
      // Renamed from EXPLORE & BUILD. "Explore" was doing no work — the column
      // is now what you can build with and how you can give back, and
      // Contribute arriving makes the second half of the name literal.
      //
      // Ordered as a builder's questions: what exists (Modules) → where is it
      // going (Roadmap) → what do I build with (Forge) → how do I put something
      // in (Contribute, Bug Bounties).
      title: 'BUILD & CONTRIBUTE',
      items: [
        { label: 'Modules', path: '/modules/' },
        { label: 'Roadmap', path: ROADMAP_PATH },
        { label: 'WinLEW Forge', path: '/winlew-forge/' },
        // Moved out of TRUST & TRANSPARENCY. The page is an ACTION — send
        // WinLEW to the Dev, Faucet, X Faucet or Burn reserve, earning
        // governance vote weight and clout. It sat under transparency because
        // the contributions are verified on-chain, but that is how it works,
        // not what it is for.
        { label: 'Contribute', path: '/contribute/' },
        // Reporting a real bug is builder work, and the page is a ledger of
        // what was earned and paid for doing it.
        { label: 'Bug Bounties', path: '/bounties/' },
        // Last, not first. It was at the top of this column purely because it
        // was added most recently, above Modules, Roadmap and the Forge.
        // The 'Soon' tag came off on 2026-08-30 when the shop opened at
        // /merch/ — the page is a real catalogue now, not a teaser.
        { label: 'Merch', path: '/merch/' },
      ],
    },
    {
      title: 'GOVERNANCE',
      items: [
        { label: 'Governance', path: '/governance/' },
        { label: 'Submit a Proposal', path: '/governance/submit/' },
        { label: 'Sponsors & Partners', path: '/partners/' },
      ],
    },
    {
      // THIRD-PARTY LINKS — added 2026-08-11 at the owner's request, so people do
      // not have to hunt for where the token trades and how to check it.
      //
      // This REVERSES a 2026-07-19 decision that external links stay embedded on
      // pages and out of the nav. Recorded so it reads as a decision, not drift.
      //
      // Deliberately SMALL. /links/ already carries all thirteen external
      // destinations; duplicating them here would create a second place to
      // maintain the same URLs, which is how two lists drift apart. These are the
      // few worth one click — buy, chart, verify — and "All external links" goes
      // to the page that owns the full set. A test asserts every URL here also
      // appears on /links/, so the short list cannot contradict the long one.
      //
      // Every URL was copied from /links/ rather than composed, and the pair is
      // the PumpSwap market verified primary on 2026-08-11 (31.64 wSOL vs
      // Raydium's 5.65).
      title: 'THIRD-PARTY LINKS',
      items: [
        { label: 'Buy on Pump.fun', path: 'https://swap.pump.fun/?input=So11111111111111111111111111111111111111112&output=DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump', external: true },
        { label: 'Swap on Raydium', path: 'https://raydium.io/swap/?inputMint=sol&outputMint=DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump', external: true },
        // DexScreener deliberately points at the RAYDIUM pool while
        // GeckoTerminal points at the primary PumpSwap one. DexScreener hides a
        // pair that has no volume, and with 24h volume at $0 everywhere the
        // PumpSwap page renders "no pair found" (verified 2026-08-12). The
        // Raydium page still draws, so the label says Raydium rather than
        // implying this is the primary market — which it is not.
        { label: 'Chart — DexScreener (Raydium)', path: 'https://dexscreener.com/solana/5nTz6Cq7U54TArLEFMgFUatcZXh5NG9BVrecqMrJ92Lx', external: true },
        { label: 'Chart — GeckoTerminal', path: 'https://www.geckoterminal.com/solana/pools/Hmif58VXfzzjHmWnX7dDcRh6MKwoz5cTw676HbvSgFtL', external: true },
        { label: 'Token on Solscan', path: 'https://solscan.io/token/DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump', external: true },
        { label: 'Safety — RugCheck', path: 'https://rugcheck.xyz/tokens/DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump', external: true },
        { label: 'CoinMarketCap', path: 'https://dex.coinmarketcap.com/token/solana/DnrcdQVH7fdbmm4EyD7LjT9mNNozF5HuWMeKcpvjpump/', external: true },
        { label: 'All external links', path: '/links/' },
      ],
    },
    {
      // Renamed from BEYOND WINLEW on 2026-10-03 (owner decision): these are
      // Oxyon projects. Oxyon is the technology side, built by the team behind
      // WinLEW; WinLEW stays the community. Wording rule: "built by the team
      // behind Oxyon", never "parent" (there is no ownership structure to claim).
      title: 'OXYON',
      // Sister projects from the same team, not WinLEW itself — kept in
      // their own group so "is this an official WinLEW page?" is never
      // ambiguous. GeoAgora/GeoHackers/GeoJustice/GeoPresence/GeoProof/
      // uBlock already have real builds elsewhere, but per the project
      // owner (2026-07-26) they are deliberately not ready to be exposed
      // publicly yet — these `path`s point ONLY at a WinLEW-hosted teaser
      // page (/ecosystem/<slug>/) that explains the vision, never at the
      // actual app/build. `tag: 'Soon'` reuses the same visual badge the
      // old non-clickable `soon: true` items had, now on a real link.
      // `external: true` opens in a new tab since it's a different site.
      // CryptoSpades used to sit indented under GeoHackers, linking to its
      // Netlify build. Netlify is retired infrastructure (owner, 2026-11-07),
      // so the menu no longer sends anyone there; /ecosystem/geohackers/
      // explains what CryptoSpades is and that it is not hosted right now.
      items: [
        // Oxyon's own site first, so the group heading has somewhere to go.
        { label: 'Oxyon', path: 'https://oxyon.io/', external: true },
        // Formerly GeoWallet. The /ecosystem/geowallet/ path is kept on purpose
        // (bookmarks and search history); only the product name changed.
        { label: 'Oxyon Wallet', path: '/ecosystem/geowallet/', tag: 'Beta' },
        // Moved out of GOVERNANCE (2026-07-31) — it sits with the other
        // outside-of-WinLEW entries rather than with our own voting pages.
        // Never "Partnership": /xyo/'s own FAQ explicitly disclaims any
        // official partnership or endorsement, and "Ecosystem" matches its
        // H1 ("Supporting the XYO Ecosystem") without implying one.
        { label: 'In the XYO Ecosystem', path: '/xyo/' },
        { label: 'GeoAgora', path: '/ecosystem/geoagora/', tag: 'Soon' },
        { label: 'GeoJustice', path: '/ecosystem/geojustice/', tag: 'Soon' },
        { label: 'GeoHackers', path: '/ecosystem/geohackers/', tag: 'Soon' },
        { label: 'GeoPresence', path: '/ecosystem/geopresence/', tag: 'Soon' },
        { label: 'GeoProof', path: '/ecosystem/geoproof/', tag: 'Soon' },
        { label: 'uBlock', path: '/ecosystem/ublock/', tag: 'Soon' },
      ],
    },
  ];

  // Shared by buildGroupedPanel() (mega-menu) and buildSiteFooter() so both
  // surfaces render `soon`/`external`/`tag`/`indent` NAV_GROUPS items
  // identically. `soon` items have no real page yet — a <span>, not an
  // <a>, so this section can never point at a 404.
  function buildNavItemNode(item, { anchorClassName = '', here = null } = {}) {
    const node = document.createElement(item.soon ? 'span' : 'a');
    if (anchorClassName) node.className = anchorClassName;
    if (item.indent) node.classList.add('navItemIndent');

    const label = document.createElement('span');
    label.className = 'navItemLabel';
    label.textContent = item.label;
    node.appendChild(label);

    const tagText = item.soon ? 'Soon' : item.tag;
    if (tagText) {
      const tag = document.createElement('span');
      tag.className = 'navItemTag';
      tag.textContent = tagText;
      node.appendChild(tag);
    }

    let isActive = false;
    if (item.soon) {
      node.classList.add('navItemSoon');
      node.setAttribute('aria-disabled', 'true');
    } else {
      node.href = item.path;
      if (item.external) {
        node.target = '_blank';
        node.rel = 'noopener noreferrer';
      }
      // External destinations are a different site — their pathname (e.g.
      // "/" for a bare origin URL) must never be compared against this
      // site's own current path, or a root-path external link falsely
      // lights up as "active" whenever the current page is "/".
      isActive = !item.external && here != null && normalizePath(item.path) === here;
      if (isActive) node.classList.add('active');
    }
    return { node, isActive };
  }

  function setNavHeight() {
    const nav = document.querySelector('.nav');
    if (nav) document.documentElement.style.setProperty('--nav-h', `${Math.ceil(nav.getBoundingClientRect().height)}px`);
  }

  function closeMenu(toggle, links) {
    links.classList.remove('navOpen');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('navMenuLock');
  }

  function openMenu(toggle, links) {
    links.classList.add('navOpen');
    toggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('navMenuLock');
    const firstLink = links.querySelector('a');
    if (firstLink) firstLink.focus({ preventScroll: true });
  }

  // Normalizes every page's toggle button to the same "☰ Menu" markup,
  // regardless of whatever text that page originally hand-authored (plain
  // "☰", nothing, etc.) — the desktop label only shows via nav.css's
  // >860px rule, so mobile still gets just the compact icon.
  function labelToggle(toggle) {
    toggle.textContent = '';
    const icon = document.createElement('span');
    icon.className = 'navToggleIcon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '☰';
    const label = document.createElement('span');
    label.className = 'navToggleLabel';
    label.textContent = 'Menu';
    toggle.append(icon, label);
    if (!toggle.getAttribute('aria-label')) toggle.setAttribute('aria-label', 'Toggle navigation menu');
  }

  function wireToggle(toggle, explicitLinks) {
    labelToggle(toggle);
    const targetId = toggle.getAttribute('aria-controls');
    const links = explicitLinks || (targetId ? document.getElementById(targetId) : toggle.parentElement?.querySelector('.navLinks'));
    if (!links) return;

    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      if (links.classList.contains('navOpen')) closeMenu(toggle, links);
      else openMenu(toggle, links);
    });

    // Space/Enter already activate a <button> natively in every browser —
    // no extra keydown handler needed for activation. Escape below returns
    // focus to the trigger so keyboard users aren't dropped at the top of
    // the document.
    links.addEventListener('click', (event) => {
      if (event.target.closest('a')) closeMenu(toggle, links);
    });

    document.addEventListener('click', (event) => {
      if (!links.classList.contains('navOpen')) return;
      if (links.contains(event.target) || toggle.contains(event.target)) return;
      closeMenu(toggle, links);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!links.classList.contains('navOpen')) return;
      closeMenu(toggle, links);
      toggle.focus({ preventScroll: true });
    });
  }

  function normalizePath(href) {
    try {
      return new URL(href, window.location.origin).pathname.replace(/\/index\.html$/, '/');
    } catch {
      return null;
    }
  }

  function normalizeCurrentPath() {
    const here = window.location.pathname.replace(/\/index\.html$/, '/');
    return here === '' ? '/' : here;
  }

  function getPageConfig(here) {
    const exact = PAGE_CONFIGS.find((config) => config.match.includes(here));
    if (exact) return exact;
    // Prefix fallback, added 2026-08-16 for /news/. Exact matching is right for
    // a fixed page list, but News generates a new URL per article — without
    // this, every future article silently renders PAGE_CONFIGS[0] (the
    // storefront identity), which is the failure this file already warns about
    // twice. Exact still wins; matchPrefix is consulted only when nothing
    // matched, so no existing page's behaviour changes.
    const prefixed = PAGE_CONFIGS.find(
      (config) => Array.isArray(config.matchPrefix) && config.matchPrefix.some((p) => here.startsWith(p))
    );
    return prefixed || PAGE_CONFIGS[0];
  }

  function applyAccent(nav, config) {
    if (!nav || !config) return;
    nav.style.setProperty('--wl-accent-rgb', config.accentRgb || '214,168,102');
    nav.style.setProperty('--wl-accent-text', config.accentText || '#f0c989');
  }

  function buildBrandIdentity(brand, config) {
    if (!brand || !config) return;
    brand.classList.add('arcadeBrand');
    if (brand.classList.contains('navBrand')) brand.classList.add('navBrandShell');
    // The logo goes to the HUB, not the landing page.
    //
    // Owner, 2026-08-15: "/home/ has once again been hidden... index.html is a
    // landing page as /home/ shows off everything... when clicking on the Logo
    // it should not take me to / it should take me to /home/. Only time
    // /index.html should load is when someone types winlew.co/".
    //
    // / is the storefront: it exists to convert a stranger who arrived from a
    // link. Once someone is inside the site, sending them back to the pitch is
    // a dead end — the hub is where everything actually is. Typing the bare
    // domain still lands on the storefront, which is the one case it is for.
    //
    // Set here rather than in each page's markup because this overwrites
    // whatever the HTML said anyway; 61 pages hardcode href="/" and every one
    // of them is corrected by this line.
    brand.href = HUB_PATH;
    brand.textContent = '';

    let avatar;
    if (config.icon && config.icon.type === 'image') {
      avatar = document.createElement('img');
      avatar.className = 'brandAvatar';
      avatar.src = config.icon.src;
      avatar.alt = config.icon.alt || '';
    } else {
      avatar = document.createElement('span');
      avatar.className = 'brandAvatar brandAvatarGlyph';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = (config.icon && config.icon.value) || '🪙';
    }

    const copy = document.createElement('span');
    copy.className = 'brandCopy';
    const title = document.createElement('span');
    title.className = 'brandTitle';
    title.textContent = 'WinLEW';
    const subtitle = document.createElement('span');
    subtitle.className = 'brandSub';
    subtitle.textContent = config.subtitle;
    subtitle.title = config.subtitle;
    copy.append(title, subtitle);
    brand.append(avatar, copy);
  }

  function watchNavHeight() {
    if (typeof window.ResizeObserver !== 'function') return;
    const observer = new window.ResizeObserver(() => {
      setNavHeight();
    });
    document.querySelectorAll('.nav').forEach((nav) => observer.observe(nav));
  }

  function renderMetricChip(chip, options) {
    chip.className = options.className;
    chip.setAttribute('aria-label', options.ariaLabel);
    if (options.title) chip.title = options.title;
    else chip.removeAttribute('title');
    chip.innerHTML = `
      <span class="navMetricKind">${options.kindLabel}</span>
      <span class="navMetricAmountRow">
        <span class="${options.iconClass}" aria-hidden="true">${options.iconText}</span>
        <span id="${options.amountId}">${options.amountText || '—'}</span>
        <span class="${options.tickerClass}">${options.tickerText}</span>
      </span>
    `;
  }

  function removeChip(navRight, selector) {
    const chip = navRight.querySelector(selector);
    if (chip) chip.remove();
  }

  function ensurePlatformChip(navRight, connectBtn, toggle, metricConfig) {
    if (!metricConfig) {
      removeChip(navRight, '#navPlatformChip');
      removeChip(navRight, '#navPointsChip');
      return null;
    }
    let chip = navRight.querySelector('#navPlatformChip, #navPointsChip');
    if (!chip) {
      const legacyChip = navRight.querySelector('#navWalletChip, .navMetricChip, .navBalanceChip, .walletPill');
      if (legacyChip && legacyChip !== connectBtn && legacyChip !== toggle) chip = legacyChip;
    }
    if (!chip) chip = document.createElement('div');
    chip.id = 'navPlatformChip';
    renderMetricChip(chip, {
      amountId: 'navPlatformAmount',
      amountText: '—',
      ariaLabel: metricConfig.defaultAriaLabel,
      title: metricConfig.defaultTitle,
      className: 'walletPill navPlatformChip navMetricChip',
      iconClass: metricConfig.iconClass,
      iconText: metricConfig.iconText,
      kindLabel: metricConfig.kindLabel,
      tickerClass: metricConfig.tickerClass,
      tickerText: metricConfig.tickerText,
    });
    navRight.insertBefore(chip, connectBtn || toggle || null);
    return chip;
  }

  function ensureWalletChip(navRight, connectBtn, toggle) {
    let chip = navRight.querySelector('#navWalletChip');
    if (chip && chip.id === 'navPlatformChip') chip = null;
    if (!chip) chip = document.createElement('div');
    chip.id = 'navWalletChip';
    renderMetricChip(chip, {
      amountId: 'navWalletAmount',
      ariaLabel: 'Connected wallet balance',
      title: 'Connected wallet balance',
      className: 'walletPill navBalanceChip navMetricChip',
      iconClass: 'navBalanceIcon',
      iconText: '◎',
      kindLabel: 'Wallet',
      tickerClass: 'navBalanceTicker',
      tickerText: 'LEW',
    });
    navRight.insertBefore(chip, connectBtn || toggle || null);
    // NOT a control any more. It was wired to disconnect because there was
    // nowhere else to put that action; the owner then clicked their own balance
    // and got "Disconnect your wallet from WinLEW?" — "when i click my balance
    // it asks me to logout." A readout that signs you out is a foot-gun sitting
    // between two things people click all day. Disconnect now lives on the
    // account pill, which is a button and says so.
    return chip;
  }

  /**
   * Click the wallet chip to disconnect from the site.
   *
   * There was no way out. Once connected, the only way to end a session was to
   * clear the browser's storage by hand — not a thing to ask of anyone, and
   * impossible for someone on a shared or borrowed machine who simply wants to
   * leave.
   *
   * Uses the existing logout(), which REVOKES the session server-side before
   * clearing local storage. Clearing storage alone would leave the token valid
   * until its TTL expired — a "disconnect" that only hides the session from the
   * person who asked to end it.
   *
   * Confirmed first, because the chip sits between two things people click all
   * day and a stray tap should not sign anyone out. Nothing is lost either way:
   * play, rewards and history belong to the ACCOUNT on the server, not to the
   * browser session, so reconnecting the same wallet brings it all back.
   */
  /** Ending the session, for real: logout() revokes server-side first, so the
   *  token is dead rather than merely hidden. Confirmed, because it sits in a
   *  row of things people click all day. */
  function performDisconnect() {
    const auth = window.WinLEWAuth;
    if (!auth || typeof auth.logout !== 'function') return;
    const ok = window.confirm(
      'Disconnect your wallet from WinLEW?\n\n'
      + 'Your play, rewards and history stay with your account — reconnecting the same wallet brings it all back.'
    );
    if (!ok) return;
    try { auth.logout(); } catch (error) { console.warn('[nav] logout failed:', error); }
    window.location.reload();
  }

  /**
   * The account pill — one control, three states.
   *
   * WHY THIS EXISTS. On 2026-08-20 a gate shipped that refused any wallet with
   * no Discord account behind it and told the person to sign in first. There
   * was no sign-in control anywhere on the site, so the instruction could not
   * be followed: "I dont even SEE WHERE ONE CAN LOGIN AT."
   *
   * WHY IT IS A STATE MACHINE. The first version had two states and got stuck
   * in the second: "the sync lives for ever and im able to click and click and
   * click." Sync is not a permanent property of an account — it is a job with
   * an end, and a button that keeps offering a finished job is broken even
   * though every click "works". So:
   *
   *   no session          -> SIGN IN     (Discord, or X where configured)
   *   session, work left  -> SYNC ACCOUNT (only the providers not yet synced)
   *   session, nothing    -> DISCONNECT
   *
   * DISCONNECT LIVES HERE NOW, not on the balance chip. It was on the chip
   * because there was nowhere else to put it, and the owner duly clicked their
   * own balance and was asked to log out.
   *
   * The last state can only be known after asking the server, so the pill
   * renders its best synchronous guess and upgrades itself when the answer
   * arrives. A pill that renders nothing until a fetch resolves is a nav that
   * flickers on every page load.
   *
   * It stays a plain <a> with a real href: it must work if the rest of the
   * page's JavaScript fails, since it is the recovery route.
   */
  function ensureSignInButton(navRight, connectBtn, toggle) {
    const auth = window.WinLEWAuth;
    const kind = auth && typeof auth.getIdentityKind === 'function' ? auth.getIdentityKind() : 'none';
    const signedIn = kind !== 'none';

    const href = auth && typeof auth.discordSignInUrl === 'function'
      ? auth.discordSignInUrl()
      // The no-JavaScript fallback must be the PROXIED form. /linked-role/* is
      // a route on the node app, not a file on the static host, so a bare
      // /linked-role/mole is a 404 page — which is what the owner hit from the
      // Mole Hub's "Verify on Discord" button on 2026-08-21.
      : '/verify/api-proxy.php/linked-role/mole';

    let link = navRight.querySelector('#navSignIn');
    if (!link) {
      link = document.createElement('a');
      link.id = 'navSignIn';
      link.className = 'pill navSignIn';
      navRight.insertBefore(link, connectBtn || toggle || null);
    }

    // Provisional. 'sync' is the safe guess for a signed-in person: it is the
    // state that offers the most, and refineAccountPill() demotes it to
    // 'disconnect' if there turns out to be nothing left to attach.
    setAccountPillState(link, signedIn ? 'sync' : 'signin', href);
    if (signedIn) void refineAccountPill(link, href);

    if (!link.dataset.syncWired) {
      link.dataset.syncWired = '1';
      link.addEventListener('click', async (event) => {
        if (typeof auth?.hubApiFetch !== 'function') return; // let the href do it
        event.preventDefault();

        const mode = link.dataset.mode || 'signin';
        if (mode === 'disconnect') { performDisconnect(); return; }

        // The lookup is a network round trip on the first click. Say so, or
        // the pill looks like it swallowed the press.
        const restore = link.innerHTML;
        link.innerHTML = 'Opening…';
        const options = await accountPillOptions(mode);
        link.innerHTML = restore;

        // One provider left and no choice to make: go straight there rather
        // than opening a menu with a single item in it.
        if (options.length === 1 && mode === 'signin') { startSignInWith(options[0], link, href); return; }
        if (options.length === 1 && mode === 'sync') { startSyncWith(options[0], link, href); return; }
        if (!options.length) { performDisconnect(); return; }
        openProviderChooser(link, href, mode, options);
      });
    }
    return link;
  }

  /** Label, title and mode for one state. Kept in one place so the three
   *  states cannot drift apart — the pill's meaning is its label. */
  function setAccountPillState(link, state, href) {
    // Icon plus WORD, so the label survives a device with no emoji font.
    const copy = {
      signin: {
        html: '<span aria-hidden="true">🔑</span> Sign in',
        title: 'Sign in with Discord or X',
      },
      sync: {
        html: '<span aria-hidden="true">🔗</span> Sync account',
        title: 'Attach Discord or X to this account to unlock payouts — your wallet stays your account',
      },
      disconnect: {
        html: '<span aria-hidden="true">⏻</span> Disconnect',
        title: 'End this session on this device',
      },
    }[state] || null;
    if (!copy) return;
    link.innerHTML = copy.html;
    link.title = copy.title;
    link.dataset.mode = state;
    // The href stays a real sign-in URL in every state, as the no-JavaScript
    // fallback: sync and disconnect both need a POST (the session lives in
    // localStorage, not a cookie, so a link cannot carry it), and a dead
    // control would be worse than one that takes a longer road.
    link.setAttribute('href', href);
    link.classList.toggle('navSignInDone', state === 'disconnect');
  }

  /** Ask the server what is actually left to do, then settle the pill. Silent
   *  on failure: the provisional state is always a usable one. */
  async function refineAccountPill(link, href) {
    const options = await accountPillOptions('sync');
    if (!link.isConnected) return;
    if (link.dataset.mode === 'signin') return; // signed out while we were asking
    setAccountPillState(link, options.length ? 'sync' : 'disconnect', href);
  }

  /** Which providers this pill should offer, for the mode it is in.
   *  Sign-in: everything that can mint a session. Sync: everything available
   *  and NOT already attached — which is what makes the job finish. */
  async function accountPillOptions(mode) {
    const providers = await loadAuthProviders();
    const all = ['discord', 'x'];
    if (mode === 'signin') {
      // Discord can always sign in; it needs no server round trip to know.
      return all.filter((key) => (key === 'discord' ? true : providers?.[key]?.canSignIn));
    }
    const account = await loadAccountIdentities();
    const synced = new Set((account?.identities || []).map((entry) => entry.provider));
    return all.filter((key) => {
      if (synced.has(key)) return false;
      return key === 'discord' ? true : Boolean(providers?.[key]?.canSync);
    });
  }

  /** What is already attached to this account, asked once per page. Null when
   *  there is no session or the lookup fails — callers treat that as "assume
   *  there is still something to do", which errs toward offering the action. */
  let accountIdentitiesPromise = null;
  function loadAccountIdentities() {
    if (accountIdentitiesPromise) return accountIdentitiesPromise;
    const auth = window.WinLEWAuth;
    if (typeof auth?.hubApiFetch !== 'function') return Promise.resolve(null);
    accountIdentitiesPromise = auth.hubApiFetch('/api/account/identities')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => (data && data.ok ? data : null))
      .catch((error) => {
        console.warn('[nav] account identities unavailable:', error);
        return null;
      });
    return accountIdentitiesPromise;
  }

  /** Delegates to wallet-auth's returnPathHere(), which owns the list of
   *  parameters that must never travel in a return path. The local fallback is
   *  for a page that somehow loaded nav.js without it — it strips nothing,
   *  because guessing a shorter list here is how the two would drift apart. */
  function currentPathForReturn() {
    const auth = window.WinLEWAuth;
    if (typeof auth?.returnPathHere === 'function') return auth.returnPathHere();
    return window.location.pathname;
  }

  /** What this deployment can offer, asked once per page. Never throws: a
   *  failed lookup degrades to "Discord only", which is the behaviour that
   *  existed before this and is always safe. */
  let authProvidersPromise = null;
  function loadAuthProviders() {
    if (authProvidersPromise) return authProvidersPromise;
    const auth = window.WinLEWAuth;
    if (typeof auth?.hubApiFetch !== 'function') return Promise.resolve(null);
    authProvidersPromise = auth.hubApiFetch('/api/account/providers')
      .then((res) => res.json())
      .then((data) => (data && data.ok ? data.providers : null))
      .catch((error) => {
        console.warn('[nav] provider list unavailable, offering Discord only:', error);
        return null;
      });
    return authProvidersPromise;
  }

  /** Start a SIGN-IN with a provider. Discord is a plain navigation; X needs a
   *  POST because the authorize URL carries a PKCE challenge the server mints
   *  per attempt and keeps. */
  async function startSignInWith(provider, link, href) {
    if (provider !== 'x') { window.location.href = href; return; }
    const auth = window.WinLEWAuth;
    const restore = link.innerHTML;
    link.innerHTML = 'Opening X…';
    try {
      // The claim binds the session that comes back to THIS tab. Minted before
      // the round trip starts; only its hash is ever sent.
      const claimHash = typeof auth.newOAuthClaim === 'function' ? await auth.newOAuthClaim() : '';
      const res = await auth.hubApiFetch('/api/account/signin/x/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ next: currentPathForReturn(), claimHash }),
      });
      const data = await res.json().catch(() => ({}));
      if (data && data.ok && data.url) { window.location.href = data.url; return; }
      throw new Error((data && data.error) || 'signin_start_failed');
    } catch (error) {
      console.warn('[nav] X sign-in start failed:', error);
      link.innerHTML = restore;
    }
  }

  /** POST the start, follow the URL the server hands back. Falls back to the
   *  plain href — the no-JavaScript route — rather than dead-ending. */
  async function startSyncWith(provider, link, href) {
    const auth = window.WinLEWAuth;
    const restore = link.innerHTML;
    const label = provider === 'x' ? 'Opening X…' : 'Opening Discord…';
    link.innerHTML = label;
    try {
      const claimHash = typeof auth.newOAuthClaim === 'function' ? await auth.newOAuthClaim() : '';
      const res = await auth.hubApiFetch(`/api/account/sync/${provider}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ next: currentPathForReturn(), claimHash }),
      });
      const data = await res.json().catch(() => ({}));
      if (data && data.ok && data.url) { window.location.href = data.url; return; }
      throw new Error((data && data.error) || 'sync_start_failed');
    } catch (error) {
      console.warn(`[nav] ${provider} sync start failed, falling back to sign-in:`, error);
      link.innerHTML = restore;
      if (provider === 'discord') window.location.href = href;
    }
  }

  /** The two-option chooser, built on demand and anchored under the pill.
   *  Dismissed by a second click, by Escape, or by clicking anywhere else —
   *  a menu with no way out is a trap on touch devices. */
  function openProviderChooser(link, href, mode, options) {
    const existing = document.getElementById('navSyncChooser');
    if (existing) { existing.remove(); return; }

    const syncing = mode === 'sync';
    const offered = Array.isArray(options) && options.length ? options : ['discord', 'x'];
    const LABELS = { discord: { glyph: '💬', name: 'Discord' }, x: { glyph: '𝕏', name: 'X' } };
    const menu = document.createElement('div');
    menu.id = 'navSyncChooser';
    menu.className = 'navSyncChooser';
    menu.setAttribute('role', 'menu');
    menu.dataset.mode = syncing ? 'sync' : 'signin';
    // Only what is still to do. A menu that keeps listing an already-synced
    // provider is how "sync" became a button you could click forever.
    const rows = offered.map((key) => {
      const meta = LABELS[key] || { glyph: '•', name: key };
      return `<button type="button" class="navSyncOption" role="menuitem" data-sync-provider="${key}">`
        + `<span aria-hidden="true">${meta.glyph}</span> ${meta.name}</button>`;
    }).join('');

    // Disconnect rides along whenever there IS a session, so ending one is
    // never more than one menu away — including for someone who still has a
    // provider left to sync and therefore never sees the pill's own
    // Disconnect state.
    const leave = syncing
      ? '<button type="button" class="navSyncOption navSyncLeave" role="menuitem" data-sync-leave="1">'
        + '<span aria-hidden="true">⏻</span> Disconnect</button>'
      : '';

    menu.innerHTML = `
      <div class="navSyncChooserTitle">${syncing ? 'Sync an account to unlock payouts' : 'Sign in with'}</div>
      ${rows}${leave}
      <div class="navSyncChooserNote">${syncing
        ? 'Either one is enough. Your wallet stays your account.'
        : 'Either one works — you do not need both.'}</div>`;
    document.body.appendChild(menu);

    // POSITIONED AFTER APPEND, because the clamp needs the real measured size.
    //
    // The first version set `right: innerWidth - rect.right` and nothing else.
    // That is correct only while the pill sits near the RIGHT edge, which is
    // where it lives on desktop. On mobile the nav wraps and Sign in lands on
    // the LEFT, so right-anchoring pushed a 232px menu off the left edge of a
    // 412px viewport — reported as "on mobile, the login dont box correctly",
    // with the menu half off-screen.
    //
    // Now: prefer right-aligned to the pill, then clamp both axes so the whole
    // menu is on screen wherever the pill happens to be.
    const rect = link.getBoundingClientRect();
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const MARGIN = 8;

    const maxLeft = Math.max(MARGIN, window.innerWidth - width - MARGIN);
    const left = Math.max(MARGIN, Math.min(rect.right - width, maxLeft));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.right = 'auto';

    // Below the pill by default; flipped above when that would run off the
    // bottom, which a short landscape viewport does easily.
    const below = rect.bottom + MARGIN;
    const top = below + height > window.innerHeight - MARGIN && rect.top - height - MARGIN > MARGIN
      ? rect.top - height - MARGIN
      : below;
    menu.style.top = `${Math.round(top)}px`;

    function close() {
      menu.remove();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('click', onAway, true);
    }
    function onKey(event) { if (event.key === 'Escape') close(); }
    function onAway(event) {
      if (menu.contains(event.target) || event.target === link || link.contains(event.target)) return;
      close();
    }
    document.addEventListener('keydown', onKey, true);
    // Deferred: this same click is still propagating, and would close the menu
    // in the act of opening it.
    setTimeout(() => document.addEventListener('click', onAway, true), 0);

    menu.querySelectorAll('[data-sync-provider]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const provider = btn.getAttribute('data-sync-provider');
        close();
        if (syncing) startSyncWith(provider, link, href);
        else startSignInWith(provider, link, href);
      });
    });

    const leaveBtn = menu.querySelector('[data-sync-leave]');
    if (leaveBtn) leaveBtn.addEventListener('click', () => { close(); performDisconnect(); });

    const first = menu.querySelector('.navSyncOption');
    if (first) first.focus();
  }

  function ensureAccountChips(nav, config) {
    const navRight = nav.querySelector('.navRight');
    if (!navRight || !config) return;
    const connectBtn = navRight.querySelector('#navWalletConnect');
    const toggle = navRight.querySelector('.navToggle');
    ensurePlatformChip(navRight, connectBtn, toggle, config.platformMetric || null);
    ensureWalletChip(navRight, connectBtn, toggle);
    ensureSignInButton(navRight, connectBtn, toggle);
  }

  function setPlatformMetric(options = {}) {
    const chip = document.getElementById('navPlatformChip');
    const amountEl = document.getElementById('navPlatformAmount');
    if (!chip || !amountEl) return;
    const amountText = options.amountText || '—';
    amountEl.textContent = amountText;
    amountEl.title = options.title || '';
    if (options.title) chip.title = options.title;
    else chip.removeAttribute('title');
    if (options.ariaLabel) chip.setAttribute('aria-label', options.ariaLabel);
  }

  function clearPlatformMetric() {
    setPlatformMetric({ amountText: '—' });
  }

  function applyPendingPlatformMetric() {
    if (!window.__winlewPendingPlatformMetric) return;
    setPlatformMetric(window.__winlewPendingPlatformMetric);
  }

  // Builds the canonical grouped full-menu panel (every destination in
  // NAV_GROUPS) as a fresh element, independent of whatever a page's own
  // .navLinks markup contained — shared by both the rebuilt-primary-row
  // pages and the arcade pages below, so the directory is byte-identical
  // (and actually functional) everywhere. Moved to be a direct child of
  // <body> for the same reason documented lower down: escaping .nav as a
  // CSS containing-block ancestor for position:fixed.
  function buildGroupedPanel(here, id) {
    const panel = document.createElement('div');
    panel.className = 'navLinks navFullMenuPanel';
    panel.setAttribute('role', 'navigation');
    panel.setAttribute('aria-label', 'WinLEW journeys and records');
    if (id) panel.id = id;
    const journeys = document.createElement('div');
    journeys.className = 'navGroup navJourneys';
    for (const item of JOURNEYS) {
      const link = document.createElement('a');
      link.className = 'pill';
      link.href = item.path;
      link.textContent = item.label;
      if (item.path === journeyFor(here)) link.setAttribute('aria-current', 'page');
      journeys.appendChild(link);
    }
    panel.appendChild(journeys);
    const records = document.createElement('details');
    records.className = 'navRecords';
    // Open by default (owner, 2026-11-14): opening the menu shows every destination at once instead of hiding
    // most of them behind a "More & records" click. The summary still collapses it; the panel scrolls (nav.css).
    records.open = true;
    const summary = document.createElement('summary');
    summary.textContent = 'More & records';
    records.appendChild(summary);
    let hasActiveMenuItem = false;
    for (const group of NAV_GROUPS) {
      const section = document.createElement('div');
      section.className = 'navGroup';
      const heading = document.createElement('div');
      heading.className = 'navGroupTitle';
      heading.textContent = group.title;
      section.appendChild(heading);
      for (const item of group.items) {
        const { node, isActive } = buildNavItemNode(item, { anchorClassName: 'pill', here });
        if (isActive && !hasActiveMenuItem) hasActiveMenuItem = true;
        section.appendChild(node);
      }
      records.appendChild(section);
    }
    panel.appendChild(records);
    document.body.appendChild(panel);
    return panel;
  }

  function buildTwoLevelNav(nav) {
    const navInner = nav.querySelector('.navInner');
    const links = nav.querySelector('.navLinks');
    if (!navInner || !links) return;

    const here = normalizeCurrentPath();
    const config = getPageConfig(here);
    const brand = nav.querySelector('a.navBrand, a.brandMark');

    navInner.classList.add('navUnified');
    applyAccent(nav, config);
    ensureAccountChips(nav, config);
    buildBrandIdentity(brand, config);
    if (brand) brand.href = '/';

    // Arcade pages (Mole Hub, Quiz, Faucet — marked by .arcadeLinks) keep
    // their own hand-curated link row exactly as-authored (How to Play,
    // Rewards, Leaderboards, etc. have no canonical NAV_GROUPS equivalent,
    // and preserving Mole Hub's distinct arcade personality is intentional
    // — see docs/site-navigation.md). But the Menu trigger next to that row
    // still needs to open the SAME complete site directory every other page
    // gets — previously it was left wired to the arcade row itself (already
    // always visible, never actually hidden behind the trigger at desktop
    // width, and pushing the header taller in place at mobile width instead
    // of floating), which read as either a dead button or a layout jump.
    if (links.classList.contains('arcadeLinks')) {
      // Keep the page-owned product controls in place; the seven journeys are
      // always the first navigation level in the same shared menu.
      // A fresh id, not the arcade row's own id (still present, unchanged,
      // on that row) — two elements can't share one id, and aria-controls
      // must point at whatever the toggle actually opens.
      const panel = buildGroupedPanel(here, 'navFullMenuPanel');
      const primary = document.createElement('div');
      primary.className = 'navPrimary';
      primary.setAttribute('role', 'navigation');
      primary.setAttribute('aria-label', 'Primary navigation');
      for (const item of JOURNEYS) {
        const link = document.createElement('a');
        link.className = 'pill';
        link.href = item.path;
        link.textContent = item.label;
        if (item.path === journeyFor(here)) {
          link.classList.add('active');
          link.setAttribute('aria-current', 'page');
        }
        primary.appendChild(link);
      }
      navInner.insertBefore(primary, links);
      const contextual = document.createElement('div');
      contextual.className = 'navGroup';
      for (const item of links.querySelectorAll('a')) contextual.appendChild(item.cloneNode(true));
      panel.querySelector('.navRecords').appendChild(contextual);
      links.hidden = true;
      links.classList.add('navProductLinks');
      const toggle = nav.querySelector('.navToggle');
      if (toggle) {
        toggle.setAttribute('aria-controls', panel.id);
        wireToggle(toggle, panel);
        toggle.dataset.navWired = '1';
      }
      return;
    }

    const primary = document.createElement('div');
    primary.className = 'navPrimary';
    primary.setAttribute('role', 'navigation');
    primary.setAttribute('aria-label', 'Primary navigation');
    for (const item of JOURNEYS) {
      const a = document.createElement('a');
      a.className = 'pill';
      a.href = item.path;
      a.textContent = item.label;
      if (item.path === journeyFor(here)) {
        a.classList.add('active');
        a.setAttribute('aria-current', 'page');
      }
      primary.appendChild(a);
    }
    navInner.insertBefore(primary, links);

    // Full menu: every canonical destination, grouped — built fresh (see
    // buildGroupedPanel above) rather than repurposing the page's own
    // .navLinks in place, then that original element is discarded. The new
    // panel keeps the original element's id so the toggle's aria-controls
    // still resolves it, and is a direct child of <body> — escaping .nav as
    // a CSS containing-block ancestor. Every page's own .nav rule sets
    // backdrop-filter (some also use filter/transform elsewhere) — any of
    // those create a new containing block for position:fixed descendants
    // per spec, which was silently clipping this panel to .nav's own
    // (much smaller) box instead of the viewport, cutting off the right-
    // hand columns of the grouped menu. Body has no such property.
    const panel = buildGroupedPanel(here, links.id || undefined);
    links.remove();

    const toggle = nav.querySelector('.navToggle');
    if (toggle) {
      wireToggle(toggle, panel);
      toggle.dataset.navWired = '1';
    }
  }

  // Shared site footer: same NAV_GROUPS data as the mega-menu (buildGroupedPanel
  // above), rendered as an always-visible sitemap at the bottom of every page
  // instead of behind the Menu toggle — for anyone who's scrolled deep into a
  // long page and won't scroll back to the header, or didn't clock the Menu
  // button in the first place. One function, one data source, injected on
  // every page that loads nav.js (no per-page HTML to keep in sync).
  function buildSiteFooter() {
    if (document.body.dataset.experience === '3') return;
    if (document.querySelector('.wlSiteFooter')) return;

    const footer = document.createElement('footer');
    footer.className = 'wlSiteFooter';

    const grid = document.createElement('div');
    grid.className = 'wlSiteFooterGrid';
    for (const group of NAV_GROUPS) {
      const col = document.createElement('div');
      col.className = 'wlSiteFooterGroup';
      const heading = document.createElement('div');
      heading.className = 'wlSiteFooterGroupTitle';
      heading.textContent = group.title;
      col.appendChild(heading);
      for (const item of group.items) {
        const { node } = buildNavItemNode(item, { anchorClassName: '' });
        col.appendChild(node);
      }
      grid.appendChild(col);
    }
    footer.appendChild(grid);

    const bottom = document.createElement('div');
    bottom.className = 'wlSiteFooterBottom';
    const home = document.createElement('a');
    home.className = 'wlSiteFooterBrand';
    home.href = '/';
    home.textContent = 'WinLEW';
    const copy = document.createElement('span');
    copy.textContent = `© ${new Date().getFullYear()} WinLEW • #LetsEveryOneWin`;
    // One honest line on where the technology comes from (owner decision
    // 2026-10-03): built by the team behind Oxyon. Not "parent", not "owned by".
    const credit = document.createElement('span');
    credit.className = 'wlSiteFooterCredit';
    credit.append('Built with technology from ');
    const oxyon = document.createElement('a');
    oxyon.href = 'https://oxyon.io/';
    oxyon.target = '_blank';
    oxyon.rel = 'noopener noreferrer';
    oxyon.textContent = 'Oxyon ↗';
    credit.appendChild(oxyon);
    bottom.append(home, credit, copy);
    footer.appendChild(bottom);

    document.body.appendChild(footer);
  }

  /**
   * Say what happened to a sync, on whatever page it landed on.
   *
   * The callbacks redirect to wherever the person STARTED, and only
   * /verify/profile.html ever rendered `?syncError=`. A real refusal came back
   * to /home/ as `?syncError=already_linked` and showed the visitor absolutely
   * nothing — they clicked Sync, went to Discord, approved, came back, and the
   * site behaved as though they had never left. A refusal nobody can see is
   * indistinguishable from a bug.
   *
   * Skipped on pages that own the message themselves, so the two never
   * double up.
   */
  function announceSyncOutcome() {
    if (document.getElementById('syncStatus')) return; // profile renders its own
    let params;
    try { params = new URLSearchParams(window.location.search); } catch { return; }
    const failed = params.get('syncError');
    const done = params.get('synced');
    if (!failed && !done) return;

    const MESSAGES = {
      // Still reachable, but rare now: since 2026-08-22 proving both sides
      // MERGES the two accounts instead of refusing, so this is left for the
      // cases where the merge itself could not be completed.
      already_linked: '🚫 That account is already synced to a different WinLEW account, and joining the '
        + 'two did not complete. Nothing changed — sign in to the account that already has it, or try again.',
      sync_failed: '⚠️ That sync did not complete. Nothing changed — you can try again.',
    };
    const merged = params.get('merged') === '1';
    const text = failed
      ? (MESSAGES[failed] || MESSAGES.sync_failed)
      : (merged
        ? `✅ ${done} synced, and your two accounts are now one. Your wallets are together — one of them gets paid.`
        : `✅ ${done} synced. Your account can receive payouts.`);

    const el = document.createElement('div');
    el.className = 'wlSyncOutcome';
    el.setAttribute('role', 'status');
    el.dataset.kind = failed ? 'error' : 'ok';
    const say = document.createElement('span');
    say.textContent = text;                       // textContent: the value came from a URL
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'wlSyncOutcomeClose';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '✕';
    close.addEventListener('click', () => el.remove());
    el.append(say, close);
    document.body.appendChild(el);

    // Take the outcome out of the address bar so a reload or a shared link does
    // not replay it — the same reasoning as the session scrub.
    try {
      params.delete('syncError');
      params.delete('merged');
      params.delete('synced');
      const rest = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
    } catch { /* history is not essential to the message */ }
  }

  function markActiveLinks() {
    const here = normalizeCurrentPath();
    document.querySelectorAll('.navPrimary a[href], .navLinks a[href], .arcadeLinks a[href]').forEach((link) => {
      const href = link.getAttribute('href') || '';
      // An in-page anchor (e.g. /modules/#roadmap) targets a section of the
      // current page, not a distinct destination — never treat it as "the"
      // active top-level link, or every tailored-primary-row anchor would
      // light up alongside (or instead of) the page's own identity link.
      if (href.includes('#')) return;
      // An external destination's pathname (e.g. "/" for a bare origin URL
      // like CryptoSpades') must never be compared against this site's own
      // current path, or a root-path external link falsely lights up as
      // "active" whenever the current page is "/".
      if (/^https?:\/\//i.test(href)) return;
      const linkPath = normalizePath(href);
      if (linkPath && linkPath === here) link.classList.add('active');
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav').forEach(buildTwoLevelNav);
    buildSiteFooter();
    announceSyncOutcome();
    setNavHeight();
    watchNavHeight();
    applyPendingPlatformMetric();
    if (window.WinLEWAuth) {
      window.WinLEWAuth.setConnectedUi(window.WinLEWAuth.getCachedWallet());
      if (typeof window.WinLEWAuth.refreshWalletBalance === 'function' && document.getElementById('navWalletAmount')) {
        window.WinLEWAuth.refreshWalletBalance().catch(() => {});
      }
    }
    // buildTwoLevelNav() already wires every toggle it touches (both the
    // rebuilt-primary-row path and the arcade path) — this pass only
    // catches any .navToggle it didn't reach for some reason, so a toggle
    // is never double-wired to two different click handlers/targets.
    document.querySelectorAll('.navToggle').forEach((toggle) => {
      if (!toggle.dataset.navWired) wireToggle(toggle);
    });
    markActiveLinks();
  });

  window.addEventListener('resize', setNavHeight);
  window.WinLEWNav = Object.assign(window.WinLEWNav || {}, {
    setPlatformMetric(options = {}) {
      window.__winlewPendingPlatformMetric = Object.assign({}, window.__winlewPendingPlatformMetric || {}, options);
      setPlatformMetric(window.__winlewPendingPlatformMetric);
    },
    clearPlatformMetric() {
      window.__winlewPendingPlatformMetric = { amountText: '—' };
      clearPlatformMetric();
    },
  });
})();

// ── WinLEW mobile app native bridge (Version 2.4 Mobile Beta) ───────────────
// This site has no build step, so the mobile/ Capacitor wrapper loads these
// exact pages remotely (capacitor.config.json's server.url) rather than
// bundling a separate copy — there is no second frontend to keep in sync.
// Capacitor auto-injects `window.Capacitor` into any page it renders,
// including this remote one, so no bundler/import is needed here. Every
// line below is a no-op on a normal desktop/mobile browser visit, since
// window.Capacitor only exists inside the native wrapper. See
// docs/mobile-beta.md.
(function () {
  function nativeReady() {
    return typeof window.Capacitor !== 'undefined'
      && typeof window.Capacitor.isNativePlatform === 'function'
      && window.Capacitor.isNativePlatform();
  }

  function plugin(name) {
    return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name];
  }

  function setupStatusBar() {
    const StatusBar = plugin('StatusBar');
    if (!StatusBar) return;
    // Content draws edge-to-edge; CSS safe-area padding (nav.css) keeps it
    // clear of the notch/status bar instead of the OS pushing the WebView
    // down. That works on iOS, where WKWebView reports real
    // env(safe-area-inset-*) values for the notch/Dynamic Island and home
    // indicator. It does NOT carry Android on its own: Android's WebView only
    // reports a safe area for a physical display cutout, never for the status
    // or navigation bars, so on a phone without a notch every env() here is
    // 0px. Since the wrapper targets SDK 35 (forced edge-to-edge), Android
    // insets are applied natively instead, in
    // mobile/android/app/src/main/java/co/winlew/app/MainActivity.java. The
    // two don't stack: once the WebView is padded clear of the cutout, the
    // value WebView reports drops to 0.
    StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
    StatusBar.setStyle({ style: 'DARK' }).catch(() => {}); // light icons/text — WinLEW is a dark theme
  }

  function hideSplash() {
    const SplashScreen = plugin('SplashScreen');
    if (SplashScreen) SplashScreen.hide().catch(() => {});
  }

  // Android back button: close an open nav menu first, then fall back to
  // normal history navigation, then exit only when there's nowhere left to
  // go — never a silent no-op and never an unexpected app-exit mid-flow.
  function setupBackButton() {
    const App = plugin('App');
    if (!App) return;
    App.addListener('backButton', ({ canGoBack }) => {
      const openMenu = document.querySelector('.navLinks.navOpen');
      if (openMenu) {
        openMenu.classList.remove('navOpen');
        document.querySelector('.navToggle[aria-expanded="true"]')?.setAttribute('aria-expanded', 'false');
        return;
      }
      if (canGoBack) window.history.back();
      else App.exitApp();
    });
  }

  // The way back in from the wallet app: co.winlew.app://auth-callback?handoff=
  // <id>. The scheme is registered in mobile/android's AndroidManifest.xml and
  // mobile/ios's Info.plist; the exchange itself lives in wallet-auth.js and
  // src/mole/nativeHandoff.js.
  //
  // Treat everything arriving here as attacker-controlled — any app on the
  // device, and any web page the user taps a link on, can fire this URL with
  // contents of its choosing. Nothing from the URL is stored. The only value
  // read is the hand-off id, and it is used solely to confirm it matches the
  // one this app itself started; the session is then fetched from the server
  // with a secret that never left the device.
  function completeHandoffAndRefresh(handoffId) {
    const auth = window.WinLEWAuth;
    if (!auth || typeof auth.completeNativeHandoff !== 'function') return Promise.resolve(false);
    return auth.completeNativeHandoff(handoffId).then((result) => {
      if (!result || !result.ok) return false;
      // Reload rather than patch the header: any page in the app may be
      // showing signed-out state, and this runs on every page.
      window.location.reload();
      return true;
    }).catch(() => false);
  }

  function setupDeepLinkReturn() {
    const App = plugin('App');
    if (!App) return;
    App.addListener('appUrlOpen', (data) => {
      let url;
      try {
        url = new URL(data.url);
      } catch (e) {
        console.warn('[native] appUrlOpen: unparseable url');
        return;
      }
      // For a custom scheme the "auth-callback" part parses as the host, but
      // don't depend on which — accept either.
      const route = `${url.hostname || ''}${url.pathname || ''}`;
      if (!/auth-callback/.test(route)) {
        console.log('[native] appUrlOpen: ignoring unrecognised route');
        return;
      }
      completeHandoffAndRefresh(url.searchParams.get('handoff') || '');
    });
  }

  // The deep link is the fast path, not the dependable one: wallet in-app
  // browsers often refuse to navigate to a custom scheme, in which case the
  // user just switches back to the app by hand and no URL is ever delivered.
  // So whenever the app returns to the foreground with a hand-off still
  // outstanding, ask the server directly. A short poll covers the case where
  // the user switches back a beat before the deposit lands.
  function setupResumeHandoffClaim() {
    const App = plugin('App');
    if (!App) return;
    let running = false;

    async function attemptClaim() {
      const auth = window.WinLEWAuth;
      if (running || !auth || typeof auth.hasPendingNativeHandoff !== 'function') return;
      if (!auth.hasPendingNativeHandoff()) return;
      running = true;
      try {
        const delays = [0, 1200, 2500, 4000];
        for (const wait of delays) {
          if (wait) await new Promise((resolve) => window.setTimeout(resolve, wait));
          if (!auth.hasPendingNativeHandoff()) return;
          if (await completeHandoffAndRefresh('')) return;
        }
      } finally {
        running = false;
      }
    }

    App.addListener('appStateChange', ({ isActive }) => { if (isActive) attemptClaim(); });
    // Also cover the launch where the OS cold-started the app from the deep
    // link and the listener above was registered too late to see it.
    attemptClaim();
  }

  // Every link that leaves winlew.co (Discord, X, Solscan, DexScreener,
  // wallet deep links like phantom.app/solflare.com universal links, etc.)
  // opens in the system browser/Custom Tab instead of navigating the native
  // WebView away from the app.
  //
  // Wallet links are the exception and are deliberately NOT sent to a Custom
  // Tab — see WALLET_APP_HOSTS below. A Custom Tab is a browser, so a wallet's
  // universal link renders as that wallet's marketing page offering a download.
  // Letting the navigation through instead lets Capacitor fire an ACTION_VIEW
  // intent, which Android resolves to the installed app. An earlier comment
  // here claimed Browser.open() was what resolved wallet links; it is not, and
  // acting on that broke wallet connect on a real device.
  // Wallet apps whose universal links must reach the app, not a browser tab.
  const WALLET_APP_HOSTS = /(^|\.)(phantom\.app|solflare\.com|jup\.ag|backpack\.app)$/i;

  function setupExternalLinks() {
    const Browser = plugin('Browser');
    if (!Browser) return;
    document.addEventListener('click', (event) => {
      const a = event.target.closest && event.target.closest('a[href]');
      if (!a) return;
      let url;
      try { url = new URL(a.getAttribute('href'), window.location.href); } catch { return; }
      if (url.origin === window.location.origin) return; // in-app navigation — leave alone
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return; // let the OS handle custom schemes itself
      // Wallet links must NOT go to a Custom Tab. A Custom Tab is a browser, so
      // phantom.app/ul/browse/... renders as Phantom's WEBSITE and offers to
      // install the app the user already has. Falling through to the default
      // navigation lets Capacitor's Bridge.launchIntent() fire an ACTION_VIEW
      // intent, which Android resolves to the installed wallet.
      if (WALLET_APP_HOSTS.test(url.hostname)) return;
      event.preventDefault();
      Browser.open({ url: url.href }).catch(() => { window.open(url.href, '_blank'); });
    });
  }

  // Standard browser online/offline events work fine inside a Capacitor
  // WebView — no extra plugin needed. A dismissible-on-reconnect banner
  // beats a silent failed fetch when a page's own app.js can't reach the
  // API (matches the "no network" state the modules and rewards code
  // already fail toward, now made visible instead of only logged).
  function setupOfflineBanner() {
    const banner = document.createElement('div');
    banner.className = 'nativeOfflineBanner hidden';
    banner.textContent = "You're offline — some WinLEW features need a connection.";
    document.addEventListener('DOMContentLoaded', () => document.body.appendChild(banner));
    const update = () => banner.classList.toggle('hidden', navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  }

  // App-lifecycle resume hook: a generic DOM event any page's own app.js
  // MAY opt into (e.g. re-fetch balances after the app was backgrounded for
  // a while) — not wired into every page this beta, documented as an
  // extension point in docs/mobile-beta.md rather than force-adding refresh
  // logic to pages that don't need it.
  function setupResumeHook() {
    const App = plugin('App');
    if (!App) return;
    App.addListener('resume', () => document.dispatchEvent(new CustomEvent('winlew:native-resume')));
  }

  if (nativeReady()) {
    document.documentElement.classList.add('is-native-app');
    setupStatusBar();
    setupBackButton();
    setupDeepLinkReturn();
    setupResumeHandoffClaim();
    setupExternalLinks();
    setupResumeHook();
    document.addEventListener('DOMContentLoaded', hideSplash);
  }
  // Offline banner is useful even in a plain mobile browser tab, not just
  // the native wrapper, so it isn't gated behind nativeReady().
  setupOfflineBanner();
})();
