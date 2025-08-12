import { defineTag } from "./define";
import { IMeta } from "./defs";
import {
  EnsureResponseSatisfiesContracts,
  ExtractContractsFromTags,
  ExtractTagsWithNonVoidReturnTypeFromMeta,
  HasContracts,
} from "./defs.returnTag";

interface IUser {
  name: string;
}
interface IOther {
  age: number;
}

const tag = defineTag<{ value: number }, IUser>({ id: "usertag" });
const tag2 = defineTag<void, IOther>({ id: "usertag2" });

// Preserve as a const tuple for type extraction
const tags = [tag.with({ value: 123 }), tag2] as const;

// Build runtime meta by spreading the tuple (meta.tags becomes an array)
const meta = { tags: [...tags] } satisfies IMeta;

// Tuple extractor – gives [IUser, IOther]
type ContractsTuple = ExtractContractsFromTags<typeof tags>;

// Meta extractor – because meta.tags is widened to an array, this yields (IUser | IOther)[]
type ContractsArray = ExtractTagsWithNonVoidReturnTypeFromMeta<typeof meta>;

// HasContracts and enforcement
type Has = HasContracts<typeof meta>; // true
type ValidResponse = EnsureResponseSatisfiesContracts<
  typeof meta,
  { name: string; age: number }
>; // OK
type InvalidResponse = EnsureResponseSatisfiesContracts<
  typeof meta,
  { name: string }
>; // never
