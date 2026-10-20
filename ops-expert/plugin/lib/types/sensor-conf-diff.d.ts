/** Read scalar leaves using their complete structural paths, never bare field names.
 * Repeated PB entries are indexed after the first occurrence (field, field[1], ...).
 * Indices express file order, not a claim that repeated sensor identities match.
 * Invalid input throws instead of producing a misleading partial restore comparison.
 */
export interface ConfScalarField {
    key: string;
    value: string;
}
export declare function confScalarFields(text: string): ConfScalarField[];
//# sourceMappingURL=sensor-conf-diff.d.ts.map