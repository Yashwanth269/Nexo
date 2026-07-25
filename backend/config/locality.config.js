/**
 * Nexo Locality Search Radii Configuration
 */

module.exports = {
    // Distance thresholds (kilometers)
    levelRadii: {
        'Village': 2.0,
        'Gram Panchayat': 5.0,
        'Town': 10.0,
        'Taluk': 20.0,
        'District': 40.0,
        'Nearby District': 100.0,
        'State': 300.0
    },

    // Progressive hierarchy sequence
    levelsOrder: [
        'Village',
        'Gram Panchayat',
        'Town',
        'Taluk',
        'District',
        'Nearby District',
        'State'
    ]
};
