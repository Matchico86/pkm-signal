/**
 * Outil d'assistance humaine pour session Cardmarket (Human-in-the-loop)
 * Ouvre Chrome avec le profil persistant pkm-signal/data/browser_profile.
 * Permet à l'utilisateur de valider Cloudflare Turnstile une bonne fois pour toutes
 * et d'enregistrer les cookies pour toutes les cotations futures.
 */

const { getPersistentContext, closeBrowserInstance, moveWindowOnScreen, moveWindowOffscreen } = require('../connectors/prices/cardmarket-playwright-scraper');

async function main() {
  console.log('=== ASSISTANCE HUMAINE CARDMARKET (HUMAN-IN-THE-LOOP) ===');
  console.log('Ouverture du navigateur Chrome avec votre profil persistant local...');

  const context = await getPersistentContext({ headless: false });
  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
  await moveWindowOnScreen(page).catch(() => {});

  const argTarget = process.argv[2];
  let targetUrl = 'https://www.cardmarket.com/fr/Pokemon/Products?idProduct=691879&language=2&minCondition=2';
  if (argTarget) {
    if (argTarget.startsWith('http')) targetUrl = argTarget;
    else targetUrl = `https://www.cardmarket.com/fr/Pokemon/Products?idProduct=${argTarget.replace(/\D/g, '')}&language=2&minCondition=2`;
  }
  console.log(`Navigation vers Cardmarket : ${targetUrl}`);

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

  console.log('\n👉 Si un challenge Cloudflare apparaît, veuillez simplement cocher la case dans la fenêtre Chrome.');
  console.log('👉 Une fois la page Cardmarket chargée, les cookies seront enregistrés automatiquement.');
  console.log('👉 Fermez la fenêtre Chrome ou faites Ctrl+C ici lorsque vous avez terminé.\n');

  // Surveiller le statut
  let resolved = false;
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(1000).catch(() => {});
    const title = (await page.title().catch(() => '')) || '';
    const isChallenge = /un instant|just a moment|attention required|vérification|cloudflare/i.test(title);
    const isBlocked = /sorry|blocked|bloqu|access denied/i.test(title);

    if (isBlocked) {
      console.error(`\n⚠️ Blocage détecté sur la page : "${title}"`);
      console.error('Assurez-vous que Cloudflare WARP est bien actif sur votre PC.\n');
      break;
    }

    const hasArticleContent = await page.$('.article-row, .article-table, .noResults').catch(() => null);
    if (!resolved && !isChallenge && !isBlocked && (hasArticleContent || (title.includes('Cardmarket') && !title.toLowerCase().includes('cloudflare')))) {
      console.log('\n=============================================================');
      console.log(`🎉 VICTOIRE ! Session Cardmarket validée avec succès !`);
      console.log(`Titre de la page : "${title}"`);
      console.log('✅ Vos cookies Cloudflare sont maintenant enregistrés dans le profil local.');
      console.log('=============================================================');
      console.log('\n👉 La page Cardmarket reste ouverte pour que vous puissiez vérifier.');
      console.log('👉 Quand vous êtes prêt, appuyez sur ENTRÉE dans ce terminal');
      console.log('   (ou fermez la fenêtre Chrome) pour terminer.\n');
      resolved = true;
      break;
    }
  }

  if (resolved) {
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise((resolve) => {
      rl.question('Appuyez sur ENTRÉE pour fermer le navigateur proprement : ', () => {
        rl.close();
        resolve();
      });
      // Détecter aussi si l'utilisateur a fermé la fenêtre Chrome à la main
      page.on('close', () => {
        try { rl.close(); } catch (_) {}
        resolve();
      });
    });
  }

  await closeBrowserInstance();
  console.log('\n✅ Navigateur fermé proprement. Vos cookies sont conservés.');
  console.log('👉 Vous pouvez maintenant lancer : npm run server:cote\n');
  process.exit(0);
}

main().catch(async (err) => {
  console.error('Erreur :', err.message);
  await closeBrowserInstance();
  process.exit(1);
});
