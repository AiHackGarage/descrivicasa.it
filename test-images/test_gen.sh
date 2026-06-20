#!/bin/bash
# Test completo con generazione AI usando foto reali
set -e

# Login
echo "=== Login ==="
LOGIN_RESP=$(curl -s -X POST https://descrivicasa.it/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"freddywhitecat+test@descrivicasa.it","password":"TestBot123!"}')
TOKEN=***"$LOGIN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
echo "Token: ${TOKEN:0:30}..."

# Crea proprietà
echo ""
echo "=== Creazione proprietà ==="
CREATE_RESP=$(curl -s -X POST https://descrivicasa.it/api/properties \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "contract_type":"sell",
    "property_type":"villa",
    "address":"Via delle Rose 15",
    "city":"Firenze",
    "province":"FI",
    "latitude":43.7696,
    "longitude":11.2558,
    "surface":250,
    "rooms":8,
    "bedrooms":4,
    "bathrooms":3,
    "floor":0,
    "total_floors":2,
    "elevator":false,
    "building_state":"Ristrutturato",
    "energy_class":"A2",
    "heating":"Riscaldamento a pavimento",
    "air_conditioning":true,
    "exposure":"Sud-Ovest",
    "balcony_sqm":30,
    "garden_sqm":500,
    "parking":true,
    "basement":true,
    "furnished":"partial",
    "year_built":2018,
    "price":850000,
    "condo_fees":0,
    "status":"draft"
  }')
echo "$CREATE_RESP" | python3 -m json.tool
PROP_ID=***"$CREATE_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))")

# Upload foto e genera descrizione
echo ""
echo "=== Generazione descrizione con foto ==="
GEN_RESP=$(curl -s -X POST "https://descrivicasa.it/api/properties/$PROP_ID/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -F "files=@/opt/data/descrivicasa.it/test-images/casa1.jpg" \
  -F "files=@/opt/data/descrivicasa.it/test-images/interno1.jpg")
echo "$GEN_RESP" | python3 -c "
import sys,json
d=json.load(sys.stdin)
if 'error' in d:
    print('ERROR:', d['error'])
else:
    desc=d.get('description','')
    title=d.get('title','')
    remaining=d.get('remaining','?')
    print(f'Titolo: {title}')
    print(f'Crediti rimasti: {remaining}')
    print(f'Descrizione ({len(desc)} chars):')
    print(desc[:800])
    if len(desc)>800: print('...(troncato)')
"

echo ""
echo "=== DONE ==="
