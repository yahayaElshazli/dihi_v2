// Accept Jellyfin API responses as well as one-title-per-line imports.
function getJellyfinVideoInfo(item) {
  const sources = item.MediaSources || item.mediaSources || [];
  const streams = [
    ...(item.MediaStreams || item.mediaStreams || []),
    ...sources.flatMap(source => source.MediaStreams || source.mediaStreams || [])
  ];
  const videoStreams = streams.filter(stream => /video/i.test(stream.Type || stream.type || ''));
  const stream = videoStreams.reduce((best, candidate) => {
    const height = Number(candidate.Height || candidate.height || 0);
    return height > Number(best?.Height || best?.height || 0) ? candidate : best;
  }, null);
  const height = Number(stream?.Height || stream?.height || 0) || null;
  const width = Number(stream?.Width || stream?.width || 0) || null;
  const source = sources[0] || {};
  const format = height >= 2000 ? '4K UHD'
    : height >= 1000 ? 'Blu-ray'
    : height >= 480 && height <= 576 ? 'DVD'
    : null;
  return {
    format,
    videoHeight: height,
    videoWidth: width,
    videoCodec: stream?.Codec || stream?.codec || null,
    container: source.Container || source.container || item.Container || item.container || null,
    fileSize: source.Size ?? source.size ?? item.Size ?? item.size ?? null
  };
}

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
    const videoInfo = getJellyfinVideoInfo(x);
    return {
      title: x.Name || x.name || x.title,
      ...videoInfo,
      format: (x.format && x.format !== 'Unknown' ? x.format : videoInfo.format) || 'Unknown',
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
