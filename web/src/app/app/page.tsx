import { AskWorkspace } from "@/components/app/AskWorkspace";
import { fileMetas, itemIndex } from "@/lib/policies";

export default function AskPage() {
  return <AskWorkspace items={itemIndex()} files={fileMetas()} />;
}
