// Fixed browser selection; all application imports remain guard-preloaded.
process.env.WINLEW_TEST_UI_BROWSER = 'edge';
await import('../winlew3Journeys.test.mjs');
