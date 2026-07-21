export const validator = Object.freeze({
  id: "synthetic-data-only",
  version: "1.0.0",
  async validate({ session }) {
    const packets = Array.isArray(session?.sourcePackets) ? session.sourcePackets : [];
    const syntheticPackets = packets.length > 0 && packets.every((packet) => (
      typeof packet?.notice === "string" && /SYNTHETIC/i.test(packet.notice)
        && typeof packet.sha256 === "string" && /^[a-f0-9]{64}$/i.test(packet.sha256)
    ));
    const syntheticSources = Array.isArray(session?.documents) && session.documents.every((document) => (
      document.status === "missing" || document.sourceRef?.artifactId?.startsWith("fixture:")
    ));
    const passed = syntheticPackets && syntheticSources;
    return {
      details: {
        packetCount: packets.length,
        syntheticPackets,
        syntheticSources,
      },
      message: passed
        ? "The session is bound to synthetic fixture evidence only."
        : "The session is missing synthetic-fixture evidence required by this local lab.",
      passed,
    };
  },
});
