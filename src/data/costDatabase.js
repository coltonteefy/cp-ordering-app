// Cost lookup database - mapped to product titles from sales CSV
export const costDatabase = {
  // RETATRUTIDE (CP-3 RT)
  "CP-3 RT 10mg": 30.00,
  "CP-3 RT 20mg": 40.00,
  "CP-3 RT 30mg": 50.00,
  "CP-3 RT 50mg": 65.00,

  // TIRZEPATIDE (CP-2 TZ)
  "CP-2 TZ 10mg": 14.00,
  "CP-2 TZ 30mg": 18.00,
  "CP-2 TZ 60mg": 30.00,

  // Growth Factors & Bioactive Peptides (Vials)
  "GHK-Cu 50MG": 20.00,
  "GHK-Cu 100mg": 25.00,
  "NAD+ 500MG": 30.00,
  "NAD+ 1000mg": 35.00,
  "EPITHALON 10MG": 15.00,
  "MOTS-C 10MG": 15.00,
  "MOTS-C 40mg": 20.00,
  "5-AMINO-1MQ 50mg": 20.00,
  "BPC-157 10MG": 20.00,
  "BPC-157 20mg": 35.00,
  "TB-500 & BPC-157 5MG/5MG": 30.00,
  "TB-500 & BPC-157 10MG/10MG": 35.00,
  "TB-500 10MG": 18.00,
  "DSIP 10 MG": 15.00,
  "TESAMORELIN 10MG": 30.00,
  "TESAMORELIN 20MG": 40.00,
  "CJC(NO DAC)/IPAMORELIN 5MG/5MG": 25.00,
  "SNAP 8 10mg": 12.00,
  "GLOW": 35.00,
  "KLOW": 45.00,
  "KPV": 15.00,
  "MT-2": 12.00,
  "VIP": 20.00,
  "$$-31 50MG": 20.00, // SS-31
  "FOX04 10mg": 44.00,
  "PT-141": 12.00,
  "THYMOSIN ALPHA 1": 20.00,

  // Sprays
  "SEMAX SPRAY 5mg": 27.00,
  "SELANK SPRAY 5mg": 27.00,
  "NAD+ SPRAY 1000mg": 30.00,
  "PT-141 SPRAY 10MG": 27.00,
  "BPC-157 SPRAY 5MG": 28.00,

  // Capsules
  "TADALAFIL 20MG (100 CT.)": 40.00,
  "SLU-PP-332 250MCG (100 CT.)": 35.00,
  "SLU-PP-332 500MCG (100 CT.)": 50.00,
  "BPC-157/KPV 500mcg/500mcg (100 CT.)": 90.00,
  "ENCLOMIPHENE LIQUID 30ML": 30.00,
  "ENCLOMIPHENE 25MG (100 CT.)": 95.00,

  // Aminos / Blends
  "ENERGY LIPO BLEND": 32.00,
  "PERFORMANCE PEAK": 32.00,
  "HELIOS EXTREME": 39.00,
  "HAIR, SKIN, NAILS BLEND": 32.00,
  "PUMP XXL": 25.00,
  "TRI IMMUNE BLEND": 32.00,
  "NEURO SPARK": 35.00,
  "BODY BOOST": 32.00,
  "METABOLIC FIRE": 39.00,
  "RECOVERY RUSH": 42.00,
  "MORNING RELAX": 27.00,
  "SLEEP MIX": 27.00,
  "VITAMIN C": 22.00,
  "B12": 22.00,
  "POWER BURN": 25.00,
  "L-CARNITINE 600MG": 28.00,
  "GLUTATHIONE AMINO 20ML": 25.00,
};

// Get cost for a product - case insensitive matching
export const getCost = (productTitle) => {
  if (!productTitle) return null;
  
  // Exact match first
  if (costDatabase[productTitle]) {
    return costDatabase[productTitle];
  }
  
  // Case-insensitive search
  const normalized = productTitle.toLowerCase();
  for (const [key, cost] of Object.entries(costDatabase)) {
    if (key.toLowerCase() === normalized) {
      return cost;
    }
  }
  
  return null;
};

// Get all available products in cost database
export const getAvailableProducts = () => {
  return Object.keys(costDatabase);
};
