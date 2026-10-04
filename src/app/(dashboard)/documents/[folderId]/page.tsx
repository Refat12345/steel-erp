import { DocumentFolderPage } from "@/components/documents/document-folder-page";

export default async function Page({
  params,
}: {
  params: Promise<{ folderId: string }>;
}) {
  const { folderId } = await params;
  return <DocumentFolderPage folderId={folderId} />;
}
