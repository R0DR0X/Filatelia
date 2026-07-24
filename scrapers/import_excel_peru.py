#!/usr/bin/env python3
import pandas as pd
import requests
import json
import re
import math

API_URL = "https://filatelia-api.rodrigopianto2005.workers.dev"
EXCEL_FILE = "/home/rodrigo/Documentos/rodri/filatelia/Peru-2020.xlsx"
BATCH_SIZE = 20

def get_existing_stamps():
    print("📡 Consultando base de datos D1 para obtener sellos de Perú existentes...")
    query_body = {
        "sql": "SELECT scottNumber, michelNumber, nameEn FROM Stamp WHERE countryCode = 'PE'"
    }
    try:
        res = requests.post(f"{API_URL}/query", json=query_body, timeout=15)
        if res.status_code == 200:
            data = res.json()
            if data.get("success"):
                results = data.get("results", [])
                
                scotts = set()
                michels = set()
                names = set()
                
                for r in results:
                    sn = r.get("scottNumber")
                    mn = r.get("michelNumber")
                    nm = r.get("nameEn")
                    
                    if sn:
                        scotts.add(str(sn).strip().lower())
                    if mn:
                        michels.add(str(mn).strip().lower())
                    if nm:
                        names.add(str(nm).strip().lower())
                        
                print(f"✅ Se encontraron {len(results)} sellos de Perú en la base de datos.")
                return scotts, michels, names
            else:
                print("⚠️ La consulta falló, se procederá sin deduplicación previa en memoria:", data.get("error"))
        else:
            print("⚠️ Status no exitoso al consultar D1:", res.status_code)
    except Exception as e:
        print("⚠️ Excepción al consultar sellos existentes:", e)
    return set(), set(), set()

def clean_val(val):
    if pd.isna(val) or val == "" or str(val).strip().lower() in ["nan", "null"]:
        return None
    return str(val).strip()

def clean_num(val):
    cleaned = clean_val(val)
    if not cleaned:
        return None
    return cleaned

def clean_denomination(val):
    if pd.isna(val) or val == "":
        return None
    try:
        # Extraer primer número decimal del string
        s = str(val).replace(',', '.')
        match = re.search(r'([\d.]+)', s)
        if match:
            return float(match.group(1))
    except Exception:
        pass
    return None

def clean_year(val):
    if pd.isna(val) or val == "":
        return None
    try:
        match = re.search(r'\b(18\d{2}|19\d{2}|20\d{2})\b', str(val))
        if match:
            return int(match.group(1))
    except Exception:
        pass
    return None

def clean_print_run(val):
    if pd.isna(val) or val == "":
        return None
    try:
        s = str(val).replace('.', '').replace(',', '').strip()
        match = re.search(r'(\d+)', s)
        if match:
            return int(match.group(1))
    except Exception:
        pass
    return None

def send_batch(stamps):
    try:
        res = requests.post(f"{API_URL}/import-stamp", json={"stamps": stamps}, timeout=20)
        if res.status_code == 200:
            result = res.json()
            if result.get("success"):
                print(f"  📦 Lote subido: +{result.get('inserted', 0)} insertados, {len(result.get('errors', []))} errores.")
                return True
            else:
                print("  ❌ API retornó error de éxito:", result.get("error"))
        else:
            print(f"  ❌ Error HTTP {res.status_code}: {res.text}")
    except Exception as e:
        print(f"  ❌ Excepción enviando lote: {e}")
    return False

def import_excel():
    print(f"📖 Cargando archivo Excel: {EXCEL_FILE}")
    try:
        df = pd.read_excel(EXCEL_FILE)
    except Exception as e:
        print(f"❌ Error leyendo el archivo Excel: {e}")
        return
        
    print(f"📊 Registros totales en el Excel: {len(df)}")
    
    # Obtener catálogos existentes para deduplicación
    existing_scotts, existing_michels, existing_names = get_existing_stamps()
    
    stamps_to_import = []
    skipped_dups = 0
    skipped_invalid = 0
    
    for idx, row in df.iterrows():
        name = clean_val(row.get('Name'))
        if not name or len(name) < 3:
            skipped_invalid += 1
            continue
            
        scott_no = clean_num(row.get('Scott No.'))
        michel_no = clean_num(row.get('Michel No.'))
        
        # Deduplicar por Scott o Michel catalog numbers
        is_dup = False
        if scott_no and scott_no.lower() in existing_scotts:
            is_dup = True
        elif michel_no and michel_no.lower() in existing_michels:
            is_dup = True
        elif name.lower() in existing_names:
            is_dup = True
            
        if is_dup:
            skipped_dups += 1
            continue
            
        # Parseo y Mapeo de columnas
        year = clean_year(row.get('Year of Issue'))
        denom = clean_denomination(row.get('Denomination'))
        image = clean_val(row.get('Image'))
        if image and image.startswith('//'):
            image = "https:" + image
            
        # Unir Series y Emission como tema/categoría
        series = clean_val(row.get('Series'))
        emission = clean_val(row.get('Emission'))
        themes = []
        if series: themes.append(series)
        if emission: themes.append(emission)
        theme_str = ", ".join(themes) if themes else None
        
        # Mapeo a la entidad Stamp del D1 API
        stamp = {
            "nameEn": name,
            "nameEs": name,
            "countryCode": "PE",
            "year": year,
            "denomination": denom,
            "imageUrl": image,
            "scottNumber": scott_no,
            "michelNumber": michel_no,
            "yvertNumber": clean_num(row.get('Stanley G. No.')), # Guardamos Stanley Gibbons en Yvert o mapeado como alternativa
            "theme": theme_str,
            "color": clean_val(row.get('Color')),
            "perforation": clean_val(row.get('Perforation')),
            "printTechnique": clean_val(row.get('Printing Type')),
            "paperType": clean_val(row.get('Material')),
            "sizeMm": clean_val(row.get('Size')),
            "source": "excel-import",
            "sourceUrl": None,
            "groupTitleEs": f"PE — Emisiones {year if year else 'Sin Año'}",
            "catalogName": "Perú (Excel 2020 Import)"
        }
        
        stamps_to_import.append(stamp)
        
        # Registrar números mapeados para no duplicar en el mismo Excel
        if scott_no:
            existing_scotts.add(scott_no.lower())
        if michel_no:
            existing_michels.add(michel_no.lower())
        existing_names.add(name.lower())

    print(f"\n🔍 Análisis de registros:")
    print(f"   - Sellos nuevos a importar: {len(stamps_to_import)}")
    print(f"   - Omitidos por duplicado:   {skipped_dups}")
    print(f"   - Omitidos por inválido:    {skipped_invalid}")
    
    if not stamps_to_import:
        print("✅ No hay sellos nuevos para importar.")
        return
        
    print(f"\n🚀 Iniciando subida de {len(stamps_to_import)} sellos en lotes de {BATCH_SIZE}...")
    
    imported_count = 0
    for i in range(0, len(stamps_to_import), BATCH_SIZE):
        batch = stamps_to_import[i:i+BATCH_SIZE]
        print(f"📤 Enviando lote {(i//BATCH_SIZE)+1} / {math.ceil(len(stamps_to_import)/BATCH_SIZE)}")
        success = send_batch(batch)
        if success:
            imported_count += len(batch)
            
    print(f"\n🎉 Proceso terminado. Se subieron {imported_count} sellos exitosamente.")

if __name__ == "__main__":
    import_excel()
