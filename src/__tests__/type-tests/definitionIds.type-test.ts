import {
  createCanonicalId,
  createLocalId,
  createSourceId,
  createStorageId,
  type CanonicalId,
  type LocalId,
  type SourceId,
  type StorageId,
} from "../../tools/definitionId";

const sourceId = createSourceId("create-user");
const localId = createLocalId(sourceId);
const canonicalId = createCanonicalId("app.tasks.create-user");
const storageId = createStorageId(canonicalId);

function acceptSourceId(_id: SourceId): void {}
function acceptLocalId(_id: LocalId): void {}
function acceptCanonicalId(_id: CanonicalId): void {}
function acceptStorageId(_id: StorageId): void {}

acceptSourceId(sourceId);
acceptSourceId(localId);
acceptLocalId(localId);
acceptCanonicalId(canonicalId);
acceptCanonicalId(storageId);
acceptStorageId(storageId);

// @ts-expect-error Local ids cannot be used where canonical ids are required.
acceptCanonicalId(localId);
// @ts-expect-error Canonical ids cannot be used where local ids are required.
acceptLocalId(canonicalId);
// @ts-expect-error Source ids cannot be used as stateful storage keys.
acceptStorageId(sourceId);
// @ts-expect-error Storage ids must be created from canonical ids.
createStorageId(localId);
