#!/usr/bin/env python3
"""Test completo DescriviCasa.it con generazione AI e foto reali"""
import subprocess, json, sys

BASE = "https://descrivicasa.it"
IMGDIR = "/opt/data/descrivicasa.it/test-images"

def api(method, path, headers=None, data=None):
    cmd = ["curl", "-s", "-X", method, BASE + path]
    if headers:
        for k, v in headers.items():
            cmd += ["-H", k + ": " + v]
    if data:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(data)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    try:
        return json.loads(r.stdout)
    except:
        return {"_raw": r.stdout}

# 1. Login
print("=== 1. Login ===")
resp = api("POST", "/api/login", data={
    "email": "freddywhitecat+test@descrivicasa.it",
    "password": "TestBot123!"
})
token = resp.get("token")
if not token:
    print("LOGIN FAILED:", resp)
    sys.exit(1)
user = resp["user"]
print("Token: %s... | Plan: %s | Credits: %s/%s" % (
    token[:30], user["plan"], user["remaining"], user["monthly_limit"]))
AUTH = "Authorization: Bearer " + token

# 2. Crea proprieta
print("\n=== 2. Creazione proprieta ===")
resp = api("POST", "/api/properties", headers={"Authorization": "Bearer " + token}, data={
    "contract_type": "sell", "property_type": "villa",
    "address": "Via delle Rose 15", "city": "Firenze", "province": "FI",
    "latitude": 43.7696, "longitude": 11.2558,
    "surface": 250, "rooms": 8, "bedrooms": 4, "bathrooms": 3,
    "floor": 0, "total_floors": 2, "elevator": False,
    "building_state": "Ristrutturato", "energy_class": "A2",
    "heating": "Riscaldamento a pavimento", "air_conditioning": True,
    "exposure": "Sud-Ovest", "balcony_sqm": 30, "garden_sqm": 500,
    "parking": True, "basement": True, "furnished": "partial",
    "year_built": 2018, "price": 850000, "condo_fees": 0, "status": "draft"
})
if resp.get("error"):
    print("CREATE FAILED:", resp["error"])
    sys.exit(1)
print("UUID:", resp.get("uuid"))

# 3. Get property ID
print("\n=== 3. Recupero ID ===")
resp = api("GET", "/api/properties", headers={"Authorization": "Bearer " + token})
props = resp.get("properties", [])
if not props:
    print("No properties found!")
    sys.exit(1)
prop_id = props[0]["id"]
print("ID: %s | Type: %s" % (prop_id, props[0]["property_type"]))

# 4. Generate description with photos
print("\n=== 4. Generazione descrizione (con 2 foto) ===")
img1 = IMGDIR + "/casa1.jpg"
img2 = IMGDIR + "/interno1.jpg"
r = subprocess.run([
    "curl", "-s", "-X", "POST",
    BASE + "/api/properties/" + str(prop_id) + "/generate",
    "-H", AUTH,
    "-F", "files=@" + img1,
    "-F", "files=@" + img2
], capture_output=True, text=True, timeout=120)
resp = json.loads(r.stdout)
if resp.get("error"):
    print("GENERATE FAILED:", resp["error"])
else:
    title = resp.get("title", "N/A")
    desc = resp.get("description", "")
    print("Titolo: %s" % title)
    print("Crediti rimasti: %s" % resp.get("remaining", "?"))
    print("Descrizione (%d chars):" % len(desc))
    print(desc[:1200])
    if len(desc) > 1200:
        print("...(troncato a 1200)")

# 5. Cleanup
print("\n=== 5. Pulizia ===")
resp = api("DELETE", "/api/properties/" + str(prop_id), headers={"Authorization": "Bearer " + token})
print("DELETE:", resp.get("message", resp.get("error", "ok")))

print("\n✅ Test completato!")
