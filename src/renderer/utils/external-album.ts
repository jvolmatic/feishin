// Mirrors the ids built by the external album providers in the main process.
export const isExternalAlbum = ({ id }: { id: string }) => id.startsWith('external:');
