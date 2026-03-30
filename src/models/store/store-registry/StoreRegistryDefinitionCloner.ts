export class StoreRegistryDefinitionCloner {
  cloneWithId<TDefinition extends { id: string }>(
    definition: TDefinition,
    id: string,
  ): TDefinition {
    const clone = Object.create(
      Object.getPrototypeOf(definition),
    ) as TDefinition;
    Object.assign(clone, definition);
    this.assignClonedDefinitionId(clone as object, id);
    return clone;
  }

  private assignClonedDefinitionId(target: object, id: string): void {
    const cloneWithDefinition = target as { definition?: unknown };
    const internalDefinition = cloneWithDefinition.definition;
    if (
      internalDefinition &&
      typeof internalDefinition === "object" &&
      "id" in internalDefinition &&
      typeof (internalDefinition as { id?: unknown }).id === "string"
    ) {
      cloneWithDefinition.definition = {
        ...(internalDefinition as Record<string, unknown>),
        id,
      };
    }

    const descriptor = Object.getOwnPropertyDescriptor(target, "id");
    if (descriptor?.writable) {
      (target as { id: string }).id = id;
      return;
    }

    Object.defineProperty(target, "id", {
      value: id,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
}
