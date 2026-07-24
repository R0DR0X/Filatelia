import asyncio
from playwright.async_api import async_playwright
import colnect_colab_scraper as scraper

async def test_run():
    # Países seleccionados para probar tanto modo directo como modo redirección de años
    test_countries = [
        {"id": "456", "name": "Abu_Dhabi", "display": "Abu Dhabi", "stamps_count": 84},
        {"id": "191", "name": "Sierra_Leone", "display": "Sierra Leone", "stamps_count": 22113},
        {"id": "90", "name": "Guinea", "display": "Guinea", "stamps_count": 26681}
    ]
    
    print("=========================================================")
    print("🧪 Iniciando test local de larga duración (Multi-Países)")
    print("=========================================================")
    
    async with async_playwright() as playwright:
        # Semáforo para controlar concurrencia a nivel local
        semaphore = asyncio.Semaphore(2)
        
        async def worker(country):
            async with semaphore:
                try:
                    await scraper.scrape_country(playwright, country, [])
                except Exception as e:
                    print(f"  ❌ Error fatal en {country['display']}: {e}")
                    
        tasks = [worker(c) for c in test_countries]
        await asyncio.gather(*tasks)

if __name__ == "__main__":
    asyncio.run(test_run())
