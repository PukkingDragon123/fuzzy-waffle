// Flippin' Waffles — recipes, customers, order generation and scoring
window.FW = window.FW || {};

FW.Orders = (() => {
  const U = FW.U;
  const ING = {
    flour: { name: 'Flour', color: '#f2ecdf' },
    sugar: { name: 'Sugar', color: '#fbe9f0' },
    egg: { name: 'Egg', color: '#f7d84a' },
    milk: { name: 'Milk', color: '#f2f6ff' },
  };
  const RECIPES = [
    { id: 'classic', name: 'Classic', batter: { flour: 2, sugar: 1, egg: 0, milk: 0 }, toppings: ['butter', 'syrup'], hint: 'butter & syrup', price: 6 },
    { id: 'berry', name: 'Berry Bliss', batter: { flour: 2, sugar: 0, egg: 0, milk: 1 }, toppings: ['strawberry', 'blueberry'], hint: 'berries', price: 7 },
    { id: 'choco', name: 'Choco Cozy', batter: { flour: 2, sugar: 2, egg: 0, milk: 0 }, toppings: ['choco', 'cream'], hint: 'choco & cream', price: 8 },
    { id: 'banana', name: 'Banana Sunrise', batter: { flour: 1, sugar: 0, egg: 1, milk: 1 }, toppings: ['banana', 'honey'], hint: 'banana & honey', price: 7 },
    { id: 'fluffy', name: 'Fluffy Cloud', batter: { flour: 2, sugar: 0, egg: 2, milk: 0 }, toppings: ['cream', 'butter'], hint: 'cream & butter', price: 7 },
    { id: 'sweet', name: 'Sweet Tooth', batter: { flour: 1, sugar: 2, egg: 0, milk: 1 }, toppings: ['syrup', 'choco'], hint: 'syrup & choco', price: 8 },
    { id: 'hearty', name: "Hiker's Hearty", batter: { flour: 2, sugar: 0, egg: 1, milk: 1 }, toppings: ['banana', 'blueberry'], hint: 'fruit', price: 8 },
    { id: 'honeybear', name: 'Honey Bear', batter: { flour: 2, sugar: 1, egg: 1, milk: 0 }, toppings: ['honey', 'butter'], hint: 'honey butter', price: 8 },
  ];
  const CUSTOMERS = [
    { name: 'Ranger Pip', kind: 'raccoon', acc: 'ranger', likes: ['classic', 'hearty'], quotes: ['Fuel for the trail!', 'Best waffles in the park, officially.'] },
    { name: 'Camper Momo', kind: 'rabbit', acc: 'beanie', likes: ['berry', 'fluffy'], quotes: ['Ooh, still warm!', 'Tent breakfast is the best breakfast.'] },
    { name: 'Hiker Juniper', kind: 'deer', acc: 'backpack', likes: ['hearty', 'banana'], quotes: ['Twelve miles today. Worth it.', 'You climbed all the way up here?!'] },
    { name: 'Basil the Photographer', kind: 'fox', acc: 'camera', likes: ['choco', 'sweet'], quotes: ['Golden hour AND golden waffles.', 'Say waffle!'] },
    { name: 'Grandma Fern', kind: 'otter', acc: 'flower', likes: ['classic', 'honeybear'], quotes: ['Just like I used to make, dear.', 'You are such a sweet wombat.'] },
    { name: 'Scout Wren', kind: 'squirrel', acc: 'cap', likes: ['sweet', 'choco'], quotes: ['Waffle badge: earned!', 'Did you see the bears? I saw the bears.'] },
  ];
  const DESTS = ['elcap', 'camp4', 'village', 'curry', 'mirror', 'glacier', 'bridalveil'];

  let rand = U.rng(12345);
  function seed(s) { rand = U.rng(s); }

  function makeOrder(day, index, destInfo) {
    // destInfo: map id -> {name, x, z, dist} (dist from home)
    const n = Math.min(3, 1 + Math.floor((day - 1 + index) / 2) + (rand() < 0.25 ? 1 : 0));
    const pool = RECIPES.slice(0, Math.min(RECIPES.length, 4 + day));
    const customer = U.pick(rand, CUSTOMERS);
    const waffles = [];
    for (let i = 0; i < n; i++) {
      const fav = customer.likes.map((id) => pool.find((r) => r.id === id)).filter(Boolean);
      const r = rand() < 0.5 && fav.length ? U.pick(rand, fav) : U.pick(rand, pool);
      waffles.push({ recipe: r });
    }
    const ids = DESTS.filter((d) => destInfo[d]);
    const dId = day === 1 && index === 0 && destInfo.camp4 ? 'camp4' : U.pick(rand, ids);
    const dest = Object.assign({ id: dId }, destInfo[dId]);
    // generous, cozy time budget: cooking + travel
    const cookTime = 40 + 35 * n;
    const rideTime = 30 + dest.dist / 9;
    return { customer, waffles, dest, cookTime, rideTime, n, id: `${day}-${index}` };
  }

  function scoreWaffle(recipe, made) {
    // made: {counts, whisk (0..1), flip(0..1), cook(0..1), toppings:Set}
    let batter = 1;
    for (const k of ['flour', 'sugar', 'egg', 'milk']) batter -= 0.26 * Math.abs((made.counts[k] || 0) - recipe.batter[k]);
    batter = U.clamp(batter, 0, 1) * (0.55 + 0.45 * made.whisk);
    const cook = U.clamp(made.flip, 0, 1);
    const want = new Set(recipe.toppings), have = made.toppings;
    let inter = 0; for (const t of have) if (want.has(t)) inter++;
    const union = new Set([...want, ...have]).size;
    const tops = union ? inter / union : 0;
    const quality = U.clamp(0.35 * batter + 0.35 * cook + 0.3 * tops, 0, 1);
    const notes = [];
    if (batter > 0.9) notes.push('Perfect batter!'); else if (batter > 0.6) notes.push('Batter a bit off.'); else notes.push('Hmm, that batter recipe...');
    if (made.flip > 0.92) notes.push('Perfectly golden!'); else if (made.doneness > 0.75) notes.push('Crispy... very crispy.'); else if (made.doneness < 0.3) notes.push('A little pale.'); else notes.push('Nicely cooked.');
    if (tops === 1) notes.push('Toppings spot on!'); else if (tops > 0.4) notes.push('Toppings almost right.'); else notes.push('Wrong toppings, oops.');
    return { batter, cook, tops, quality, notes, price: recipe.price };
  }

  function payout(order, results, rideLeftFrac, stolen, trickPoints) {
    let coins = 0;
    const lines = [];
    results.forEach((r, i) => {
      const gone = i >= results.length - stolen;
      const c = gone ? 0 : Math.round(r.price * (0.3 + 0.7 * r.quality));
      coins += c;
      lines.push({ label: `${order.waffles[i].recipe.name}${gone ? ' (eaten by a bear!)' : ''}`, value: c, quality: r.quality });
    });
    const speedTip = Math.round(8 * U.clamp(rideLeftFrac, 0, 1));
    const trickTip = Math.min(10, Math.floor(trickPoints / 3));
    coins += speedTip + trickTip;
    lines.push({ label: 'Speedy delivery tip', value: speedTip });
    if (trickTip) lines.push({ label: 'Style tip (tricks!)', value: trickTip });
    const avgQ = results.length ? results.reduce((a, r) => a + r.quality, 0) / results.length : 0;
    const happiness = U.clamp(0.6 * avgQ + 0.25 * rideLeftFrac + 0.15 - 0.25 * stolen, 0, 1);
    return { coins, lines, happiness, avgQ };
  }

  return { ING, RECIPES, CUSTOMERS, DESTS, seed, makeOrder, scoreWaffle, payout };
})();
