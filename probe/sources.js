// Candidate NYC roommate/room-rental sources for feasibility testing.
// `paths` are the listing/search paths a scraper would need; they are only
// checked against robots.txt in the rules stage, never fetched there.

export const USER_AGENT = 'ApartmentHunterBot/0.1 (+https://github.com/sdrucker6637/apartment-hunter; personal NYC roommate search; low volume)';

export const SOURCES = [
  {
    id: 'reddit', name: 'Reddit', origin: 'https://www.reddit.com',
    paths: ['/r/RoommatesNYC/new.json', '/r/RoommatesNYC/new/.rss', '/r/NYCapartments/new.json', '/r/RoommatesNYC/'],
    terms: ['https://redditinc.com/policies/data-api-terms', 'https://redditinc.com/policies/user-agreement'],
  },
  {
    id: 'craigslist', name: 'Craigslist NYC', origin: 'https://newyork.craigslist.org',
    paths: ['/search/roo', '/search/sub', '/search/apa'],
    terms: ['https://www.craigslist.org/about/terms.of.use/en'],
  },
  {
    id: 'spareroom', name: 'SpareRoom', origin: 'https://www.spareroom.com',
    paths: ['/rooms-for-rent/new-york', '/roommates/new-york', '/rooms-for-rent/'],
    terms: ['https://www.spareroom.com/content/padded/terms-us', 'https://www.spareroom.com/content/info-faq/terms-of-use-us/'],
  },
  {
    id: 'roomi', name: 'Roomi', origin: 'https://roomiapp.com',
    paths: ['/rooms-for-rent/new-york', '/rooms-for-rent/'],
    terms: ['https://roomiapp.com/terms', 'https://roomiapp.com/terms-of-service', 'https://roomiapp.com/tos'],
  },
  {
    id: 'listingsproject', name: 'Listings Project', origin: 'https://www.listingsproject.com',
    paths: ['/real-estate/new-york-city', '/listings', '/real-estate'],
    terms: ['https://www.listingsproject.com/terms', 'https://www.listingsproject.com/terms-of-use', 'https://www.listingsproject.com/terms-and-conditions'],
  },
  {
    id: 'streeteasy', name: 'StreetEasy', origin: 'https://streeteasy.com',
    paths: ['/rooms-for-rent/nyc', '/for-rent/nyc', '/for-rent/nyc/beds:2'],
    terms: ['https://streeteasy.com/info/terms-of-use', 'https://streeteasy.com/terms'],
  },
  {
    id: 'facebook', name: 'Facebook', origin: 'https://www.facebook.com',
    paths: ['/groups/', '/marketplace/nyc/propertyrentals'],
    terms: ['https://www.facebook.com/apps/site_scraping_tos_terms.php', 'https://www.facebook.com/legal/terms'],
  },
  // Other NYC-relevant candidates discovered during research
  {
    id: 'leasebreak', name: 'Leasebreak (NYC sublets/lease takeovers)', origin: 'https://www.leasebreak.com',
    paths: ['/', '/sublets', '/short-term-rentals', '/rentals'],
    terms: ['https://www.leasebreak.com/terms', 'https://www.leasebreak.com/terms-of-use', 'https://www.leasebreak.com/tos'],
  },
  {
    id: 'roomster', name: 'Roomster', origin: 'https://www.roomster.com',
    paths: ['/rooms/new-york', '/roommates/new-york', '/'],
    terms: ['https://www.roomster.com/terms', 'https://www.roomster.com/tos'],
  },
  {
    id: 'diggz', name: 'Diggz', origin: 'https://www.diggz.co',
    paths: ['/rooms-for-rent/new-york-ny', '/'],
    terms: ['https://www.diggz.co/terms', 'https://www.diggz.co/terms-of-use'],
  },
  {
    id: 'roomies', name: 'Roomies.com', origin: 'https://www.roomies.com',
    paths: ['/rooms/new-york-ny', '/'],
    terms: ['https://www.roomies.com/terms', 'https://www.roomies.com/terms-of-service'],
  },
  {
    id: 'bungalow', name: 'Bungalow (co-living rooms)', origin: 'https://bungalow.com',
    paths: ['/homes/new-york-city', '/new-york-city', '/'],
    terms: ['https://bungalow.com/terms', 'https://bungalow.com/terms-of-use', 'https://bungalow.com/legal/terms'],
  },
  {
    id: 'junehomes', name: 'June Homes (rooms/co-living)', origin: 'https://junehomes.com',
    paths: ['/residences/new-york', '/new-york-city', '/'],
    terms: ['https://junehomes.com/terms', 'https://junehomes.com/terms-of-use'],
  },
  {
    id: 'outpostclub', name: 'Outpost Club (co-living)', origin: 'https://www.outpost-club.com',
    paths: ['/rooms', '/new-york', '/'],
    terms: ['https://www.outpost-club.com/terms', 'https://www.outpost-club.com/terms-of-use'],
  },
  {
    id: 'common', name: 'Common (co-living)', origin: 'https://www.common.com',
    paths: ['/new-york-city', '/'],
    terms: ['https://www.common.com/terms', 'https://www.common.com/legal/terms'],
  },
  {
    id: 'padmapper', name: 'PadMapper', origin: 'https://www.padmapper.com',
    paths: ['/apartments/new-york-ny', '/rooms/new-york-ny'],
    terms: ['https://www.padmapper.com/terms', 'https://www.padmapper.com/tos'],
  },
  {
    id: 'zumper', name: 'Zumper', origin: 'https://www.zumper.com',
    paths: ['/rooms-for-rent/new-york-ny', '/apartments-for-rent/new-york-ny'],
    terms: ['https://www.zumper.com/terms', 'https://www.zumper.com/terms-of-use'],
  },
  {
    id: 'renthop', name: 'RentHop', origin: 'https://www.renthop.com',
    paths: ['/apartments-for-rent/new-york-ny', '/search/nyc', '/rooms-for-rent/new-york-ny'],
    terms: ['https://www.renthop.com/terms', 'https://www.renthop.com/terms-of-use'],
  },
  {
    id: 'hotpads', name: 'HotPads', origin: 'https://hotpads.com',
    paths: ['/new-york-ny/rooms-for-rent', '/new-york-ny/apartments-for-rent'],
    terms: ['https://hotpads.com/terms', 'https://hotpads.com/terms-of-use'],
  },
  {
    id: 'sublet', name: 'Sublet.com', origin: 'https://www.sublet.com',
    paths: ['/new-york-rentals', '/'],
    terms: ['https://www.sublet.com/terms', 'https://www.sublet.com/terms-of-use'],
  },
  {
    id: 'nooklyn', name: 'Nooklyn (NYC rooms/apartments)', origin: 'https://nooklyn.com',
    paths: ['/rooms', '/rentals', '/'],
    terms: ['https://nooklyn.com/terms', 'https://nooklyn.com/terms-of-service', 'https://nooklyn.com/terms-of-use'],
  },
  {
    id: 'habyt', name: 'Habyt (co-living)', origin: 'https://www.habyt.com',
    paths: ['/new-york', '/en/new-york', '/'],
    terms: ['https://www.habyt.com/terms', 'https://www.habyt.com/terms-and-conditions', 'https://www.habyt.com/en/terms'],
  },
  {
    id: 'bedly', name: 'Bedly (NYC rooms)', origin: 'https://bedly.com',
    paths: ['/rooms', '/new-york', '/'],
    terms: ['https://bedly.com/terms', 'https://bedly.com/terms-of-service', 'https://bedly.com/terms-of-use'],
  },
  {
    id: 'colivingcom', name: 'Coliving.com', origin: 'https://coliving.com',
    paths: ['/new-york', '/new-york-city', '/'],
    terms: ['https://coliving.com/terms', 'https://coliving.com/terms-of-service', 'https://coliving.com/terms-and-conditions'],
  },
  {
    id: 'housinganywhere', name: 'HousingAnywhere', origin: 'https://housinganywhere.com',
    paths: ['/s/New-York--United-States', '/'],
    terms: ['https://housinganywhere.com/terms', 'https://housinganywhere.com/terms-of-use', 'https://housinganywhere.com/terms-and-conditions'],
  },
  {
    id: 'tripalink', name: 'Tripalink (co-living)', origin: 'https://www.tripalink.com',
    paths: ['/new-york', '/'],
    terms: ['https://www.tripalink.com/terms', 'https://www.tripalink.com/terms-of-service', 'https://www.tripalink.com/terms-of-use'],
  },
  {
    id: 'roommatescom', name: 'Roommates.com', origin: 'https://www.roommates.com',
    paths: ['/rooms/new-york', '/'],
    terms: ['https://www.roommates.com/terms', 'https://www.roommates.com/terms-of-use', 'https://www.roommates.com/terms-of-service'],
  },
  {
    id: 'roomiematch', name: 'RoomieMatch', origin: 'https://www.roomiematch.com',
    paths: ['/'],
    terms: ['https://www.roomiematch.com/terms.php', 'https://www.roomiematch.com/terms', 'https://www.roomiematch.com/tos.php'],
  },
  {
    id: 'kopa', name: 'Kopa', origin: 'https://www.kopa.co',
    paths: ['/new-york-ny', '/'],
    terms: ['https://www.kopa.co/terms', 'https://www.kopa.co/terms-of-service', 'https://www.kopa.co/terms-of-use'],
  },
  {
    id: 'furnishedfinder', name: 'Furnished Finder', origin: 'https://www.furnishedfinder.com',
    paths: ['/housing/New-York/New-York', '/'],
    terms: ['https://www.furnishedfinder.com/terms', 'https://www.furnishedfinder.com/terms-of-use', 'https://www.furnishedfinder.com/terms-of-service'],
  },
  {
    id: 'padsplit', name: 'PadSplit', origin: 'https://www.padsplit.com',
    paths: ['/rooms-for-rent/new-york', '/'],
    terms: ['https://www.padsplit.com/terms', 'https://www.padsplit.com/terms-of-use', 'https://www.padsplit.com/terms-of-service'],
  },
];
