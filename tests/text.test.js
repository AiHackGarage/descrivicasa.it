const { normalizePhotos, extractTitle, slugify, injectContacts, cleanForPdf, propertyTypeLabel, buildMetaDescription } = require('../src/utils/text');

describe('Text Utils', () => {
  describe('normalizePhotos', () => {
    test('returns array as-is', () => {
      expect(normalizePhotos(['a', 'b'])).toEqual(['a', 'b']);
    });

    test('parses JSON string', () => {
      expect(normalizePhotos('["/media/x.jpg"]')).toEqual(['/media/x.jpg']);
    });

    test('returns empty array for null/undefined', () => {
      expect(normalizePhotos(null)).toEqual([]);
      expect(normalizePhotos(undefined)).toEqual([]);
    });

    test('returns empty array for invalid JSON', () => {
      expect(normalizePhotos('not-json')).toEqual([]);
    });

    test('returns empty array for non-array JSON', () => {
      expect(normalizePhotos('{"x":1}')).toEqual([]);
    });
  });
  describe('extractTitle', () => {
    test('estracts title from 🏡 marker', () => {
      const desc = '🏡 Appartamento luminoso in zona Prati\n\n📝 Descrizione...';
      expect(extractTitle(desc, null)).toBe('Appartamento luminoso in zona Prati');
    });

    test('falls back to property data when title too long', () => {
      const desc = '🏡 Questo splendido appartamento situato nel cuore di Roma con vista panoramica e terrazzo abitabile di oltre 50 metri quadri\n\n📝 Descrizione...';
      const property = { property_type: 'apartment', city: 'Roma' };
      expect(extractTitle(desc, property)).toBe('Appartamento in Roma');
    });

    test('returns null for empty description', () => {
      expect(extractTitle('', null)).toBeNull();
      expect(extractTitle(null, null)).toBeNull();
    });

    test('returns raw text when no 🏡 marker and text is short', () => {
      const property = { property_type: 'villa', city: 'Milano' };
      expect(extractTitle('Just some text without emoji', property)).toBe('Just some text without emoji');
    });
  });

  describe('slugify', () => {
    test('converts text to URL-friendly slug', () => {
      expect(slugify('Appartamento in Roma Centro')).toBe('appartamento-in-roma-centro');
    });

    test('removes accents', () => {
      expect(slugify('Attico con terrazzo panoramico')).toBe('attico-con-terrazzo-panoramico');
    });

    test('handles empty input', () => {
      expect(slugify('')).toBe('');
      expect(slugify(null)).toBe('');
    });

    test('truncates to 80 chars', () => {
      const long = 'a'.repeat(100);
      expect(slugify(long).length).toBeLessThanOrEqual(80);
    });
  });

  describe('injectContacts', () => {
    test('replaces AI-generated contacts with real ones', () => {
      const desc = '🏡 Bella casa\n\n📝 Descrizione\n\n📞 CONTATTI\nPer info chiamare\n';
      const property = { agent_phone: '+39123456789', agent_email: 'agent@test.it' };
      const result = injectContacts(desc, property);
      expect(result).toContain('📞 CONTATTI');
      expect(result).toContain('+39123456789');
      expect(result).toContain('agent@test.it');
      expect(result).not.toContain('Per info chiamare');
    });

    test('handles missing contacts gracefully', () => {
      const desc = '🏡 Bella casa\n\n📞 CONTATTI\nsome text';
      const result = injectContacts(desc, {});
      expect(result).toContain('📞 CONTATTI');
    });
  });

  describe('cleanForPdf', () => {
    test('removes emoji', () => {
      const input = '🏡 Casa bella 📝 con terrazzo 📞 info';
      const output = cleanForPdf(input);
      expect(output).not.toContain('🏡');
      expect(output).not.toContain('📝');
      expect(output).not.toContain('📞');
      expect(output).toContain('Casa bella');
      expect(output).toContain('con terrazzo');
    });

    test('collapses multiple empty lines', () => {
      const input = 'Line 1\n\n\n\nLine 2';
      expect(cleanForPdf(input)).toBe('Line 1\n\nLine 2');
    });
  });

  describe('propertyTypeLabel', () => {
    test('returns Italian labels', () => {
      expect(propertyTypeLabel('apartment')).toBe('Appartamento');
      expect(propertyTypeLabel('villa')).toBe('Villa');
      expect(propertyTypeLabel('garage')).toBe('Box auto');
    });

    test('returns raw value for unknown types', () => {
      expect(propertyTypeLabel('bungalow')).toBe('bungalow');
    });
  });

  describe('buildMetaDescription', () => {
    test('builds SEO meta description', () => {
      const p = {
        property_type: 'apartment',
        contract_type: 'sell',
        city: 'Roma',
        price: 250000,
        surface: 80,
        rooms: 3,
      };
      const desc = buildMetaDescription(p);
      expect(desc).toContain('Appartamento');
      expect(desc).toContain('in vendita');
      expect(desc).toContain('Roma');
      expect(desc).toContain('250.000');
      expect(desc.length).toBeLessThanOrEqual(160);
    });
  });
});
