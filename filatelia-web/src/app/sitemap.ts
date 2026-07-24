import { MetadataRoute } from "next";

const API = "https://filatelia-api.rodrigopianto2005.workers.dev";

export const runtime = "edge";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: "https://filateliaperuana.com/", priority: 1.0, changeFrequency: "daily" },
    { url: "https://filateliaperuana.com/biblioteca", priority: 0.9, changeFrequency: "daily" },
    { url: "https://filateliaperuana.com/catalogo", priority: 0.9, changeFrequency: "weekly" },
    { url: "https://filateliaperuana.com/identificar", priority: 0.7, changeFrequency: "monthly" },
    { url: "https://filateliaperuana.com/tienda", priority: 0.7, changeFrequency: "monthly" },
    { url: "https://filateliaperuana.com/subastas", priority: 0.7, changeFrequency: "monthly" },
    { url: "https://filateliaperuana.com/estadisticas", priority: 0.5, changeFrequency: "weekly" },
    { url: "https://filateliaperuana.com/login", priority: 0.3, changeFrequency: "yearly" },
    { url: "https://filateliaperuana.com/registro", priority: 0.3, changeFrequency: "yearly" },
  ];

  try {
    const res = await fetch(`${API}/countries`);
    const data = await res.json();
    const countries = data.countries || [];
    const countryPages: MetadataRoute.Sitemap = countries.map((c: any) => ({
      url: `https://filateliaperuana.com/paises/${c.code.toLowerCase()}`,
      priority: 0.5,
      changeFrequency: "monthly" as const,
    }));
    return [...staticPages, ...countryPages];
  } catch {
    return staticPages;
  }
}
