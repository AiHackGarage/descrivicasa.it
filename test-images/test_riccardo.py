#!/usr/bin/env python3
"""Test generazione con le foto scelte da Riccardo"""
import subprocess, json, sys

BASE = "https://descrivicasa.it"
IMGDIR = "/opt/data/descrivicasa.it/test-images"

# Login
resp = json.loads(subprocess.run(
    ["curl", "-s", "-X", "POST", BASE + "/api/login",
     "-H", "Content-Type: application/json",
     "-d", '{"email":"freddywhitecat+test@descrivicasa.it","password":"TestBot123!"}'],
    capture_output=True, text=True
).stdout)
token = resp["token"]
AUTH = "Authorization: Bearer " + token
print("Login OK | Credits: %s/%s" % (resp["user"]["remaining"], resp["user"]["monthly_limit"]))

# Crea proprieta
resp = json.loads(subprocess.run(
    ["curl", "-s", "-X", "POST", BASE + "/api/properties",
     "-H", AUTH, "-H", "Content-Type: application/json",
     "-d", json.dumps({
        "contract_type":"sell","property_type":"attico","address":"Via del Corso 88",
        "city":"Milano","province":"MI","latitude":45.4642,"longitude":9.1900,
        "surface":120,"rooms":5,"bedrooms":2,"bathrooms":2,"floor":6,
        "total_floors":7,"elevator":True,"building_state":"Ristrutturato",
        "energy_class":"A1","heating":"Riscaldamento a pavimento",
        "air_conditioning":True,"exposure":"Sud-Est","balcony_sqm":40,
        "parking":True,"furnished":"partial","year_built":2020,
        "price":650000,"condo_fees":200,"status":"draft"
    })],
    capture_output=True, text=True
).stdout)
if resp.get("error"):
    print("CREATE FAILED:", resp["error"]); sys.exit(1)
print("UUID: %s" % resp["uuid"])

# Get ID
resp = json.loads(subprocess.run(
    ["curl", "-s", BASE + "/api/properties", "-H", AUTH],
    capture_output=True, text=True
).stdout)
prop_id = resp["properties"][0]["id"]
print("ID: %s" % prop_id)

# Genera con le 3 foto di Riccardo
print("\n=== GENERAZIONE CON 3 FOTO ===")
r = subprocess.run([
    "curl", "-s", "-X", "POST", BASE + "/api/properties/" + str(prop_id) + "/generate",
    "-H", AUTH,
    "-F", "files=@" + IMGDIR + "/terrazzo.jpg",
    "-F", "files=@" + IMGDIR + "/cucina.jpg",
    "-F", "files=@" + IMGDIR + "/corridoio.jpg"
], capture_output=True, text=True, timeout=120)
resp = json.loads(r.stdout)
if resp.get("error"):
    print("ERROR:", resp["error"])
else:
    print("Titolo:", resp.get("title"))
    print("Crediti:", resp.get("remaining"))
    desc = resp.get("description", "")
    print("Lunghezza:", len(desc), "chars")
    print("---")
    print(desc[:1500])

# Cleanup
subprocess.run(["curl", "-s", "-X", "DELETE", BASE + "/api/properties/" + str(prop_id), "-H", AUTH],
               capture_output=True, text=True)
print("\n✅ Pulito e fatto!")
