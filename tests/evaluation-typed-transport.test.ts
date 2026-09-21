import { describe, expect, it } from "vitest";
import { parseDevelopmentOptions } from "../eval/development-control";

describe("explicit development extraction transport", () => {
  it("retains the existing default and requires a live run for the typed candidate", () => {
    expect(parseDevelopmentOptions(["--name", "typed-test", "--phase", "before"]).extractionTransport).toBe("legacy_v5");
    expect(parseDevelopmentOptions(["--name", "typed-test", "--phase", "after", "--live", "--extraction-transport", "typed_fields_v1"]).extractionTransport).toBe("typed_fields_v1");
    expect(parseDevelopmentOptions(["--name", "typed-validation", "--phase", "before", "--live", "--extraction-transport", "typed_fields_v1"]).extractionTransport).toBe("typed_fields_v1");
    expect(parseDevelopmentOptions(["--name", "typed-validation", "--phase", "before", "--live", "--extraction-transport", "typed_fields_v2"]).extractionTransport).toBe("typed_fields_v2");
    expect(() => parseDevelopmentOptions(["--name", "typed-test", "--phase", "before", "--extraction-transport", "typed_fields_v1"])).toThrow("live");
    expect(() => parseDevelopmentOptions(["--name", "typed-test", "--phase", "after", "--live", "--extraction-transport", "repair-evidence"])).toThrow("transport");
  });
});
