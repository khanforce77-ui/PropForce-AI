/** Opens a private file fetched with the admin's session in a new tab (blob URL, never cached). */
export async function openPrivateFile(fetchBlob: () => Promise<Blob>) {
  const tab = window.open('', '_blank');
  const blob = await fetchBlob();
  const url = URL.createObjectURL(blob);
  if (tab) tab.location.href = url;
  else window.location.href = url;
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
