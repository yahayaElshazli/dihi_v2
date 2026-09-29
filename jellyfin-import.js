// Accept Jellyfin API responses as well as one-title-per-line imports.
function extractItems(raw) {
  const text = String(raw || '').trim();
  if (!text) return { items: [] };
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (_) {
    if (/^[\[{]/.test(text)) return { items: [], jsonError: true };
    return { items: text.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(title => ({ title, format: 'Unknown', mediaType: 'Movie' })) };
  }
  const source = Array.isArray(parsed) ? parsed : (parsed.Items || parsed.items || parsed.BaseItems || []);
  if (!Array.isArray(source)) return { items: [], jsonError: true };
  const items = source.filter(x => x && (x.Name || x.name || x.title)).map(x => {
    const jellyType = x.Type || x.type || '';
    const mediaType = /series/i.test(jellyType) ? 'Series' : (/boxset|box set/i.test(jellyType) ? 'BoxSet' : 'Movie');
    const premiere = x.PremiereDate || x.premiereDate || null;
    const year = x.ProductionYear || x.productionYear || (premiere && Number(String(premiere).slice(0, 4))) || null;
    const providerIds = x.ProviderIds || x.providerIds || {};
    return {
      title: x.Name || x.name || x.title,
      format: x.format || 'Unknown',
      productionYear: year,
      premiereDate: premiere ? String(premiere).slice(0, 10) : null,
      officialRating: x.OfficialRating || null,
      communityRating: x.CommunityRating ?? null,
      runtimeMinutes: x.RunTimeTicks ? Math.round(Number(x.RunTimeTicks) / 600000000) : null,
      mediaType,
      status: x.Status || null,
      providerIds,
      jellyfinId: x.Id || x.id || null,
      jellyfinCollectionIds: x.CollectionIds || [],
      jellyfinCollectionNames: x.CollectionNames || []
    };
  });
  return { items };
}
