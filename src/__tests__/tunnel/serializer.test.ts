
import { EjsonSerializer, EJSON, getDefaultSerializer } from "../../globals/resources/tunnel/serializer";

describe("tunnel serializer", () => {
  it("getDefaultSerializer returns the shared EJSON serializer", () => {
    const serializer = getDefaultSerializer();
    expect(serializer).toBe(EjsonSerializer);

    const now = new Date("2024-01-02T03:04:05.006Z");
    const encoded = serializer.stringify({ now });
    expect(encoded).toContain("$date");

    const decoded = serializer.parse<{ now: Date }>(encoded);
    expect(decoded.now).toBeInstanceOf(Date);
    expect(decoded.now.getTime()).toBe(now.getTime());
  });

  it("Runner EJSON export stays in sync with serializer implementation", () => {
    const payload = { when: new Date("2024-05-03T04:05:06.123Z"), nested: { flag: true } };
    const viaSerializer = EjsonSerializer.stringify(payload);
    const viaExport = EJSON.stringify(payload);
    expect(viaSerializer).toBe(viaExport);

    const parsedFromSerializer = EjsonSerializer.parse<typeof payload>(viaExport);
    const parsedFromExport = EJSON.parse(viaSerializer) as typeof payload;
    expect(parsedFromSerializer.when.getTime()).toBe(payload.when.getTime());
    expect(parsedFromExport.when.getTime()).toBe(payload.when.getTime());
  });
});
