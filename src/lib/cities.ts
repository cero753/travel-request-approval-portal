/**
 * City suggestions for the route fields.
 *
 * PRD 4.1 asks for autocomplete but names no data source. A bundled list needs
 * no API key, no network call and no vendor to be up at 2am, and the field
 * still accepts free text — so an unlisted town is typed, not blocked. The
 * autocomplete is a convenience, never a constraint.
 */
export const CITIES: string[] = [
  // India — the overwhelming majority of trips
  'Agra', 'Ahmedabad', 'Aizawl', 'Ajmer', 'Aligarh', 'Allahabad (Prayagraj)', 'Amravati',
  'Amritsar', 'Aurangabad', 'Bareilly', 'Belgaum', 'Bengaluru', 'Bhavnagar', 'Bhilai',
  'Bhiwandi', 'Bhopal', 'Bhubaneswar', 'Bikaner', 'Bilaspur', 'Chandigarh', 'Chennai',
  'Coimbatore', 'Cuttack', 'Dehradun', 'Delhi', 'Dhanbad', 'Durgapur', 'Erode', 'Faridabad',
  'Firozabad', 'Gandhinagar', 'Gaya', 'Ghaziabad', 'Goa (Panaji)', 'Gorakhpur', 'Gulbarga',
  'Guntur', 'Gurugram', 'Guwahati', 'Gwalior', 'Haridwar', 'Hubli-Dharwad', 'Hyderabad',
  'Imphal', 'Indore', 'Itanagar', 'Jabalpur', 'Jaipur', 'Jalandhar', 'Jammu', 'Jamnagar',
  'Jamshedpur', 'Jhansi', 'Jodhpur', 'Kakinada', 'Kalyan-Dombivli', 'Kanpur', 'Karnal',
  'Kochi', 'Kohima', 'Kolhapur', 'Kolkata', 'Kollam', 'Kota', 'Kozhikode', 'Kurnool',
  'Lucknow', 'Ludhiana', 'Madurai', 'Malegaon', 'Mangaluru', 'Mathura', 'Meerut', 'Moradabad',
  'Mumbai', 'Muzaffarpur', 'Mysuru', 'Nagpur', 'Nanded', 'Nashik', 'Navi Mumbai', 'Nellore',
  'Noida', 'Patna', 'Puducherry', 'Pune', 'Raipur', 'Rajahmundry', 'Rajkot', 'Ranchi',
  'Rourkela', 'Saharanpur', 'Salem', 'Sangli', 'Shillong', 'Shimla', 'Siliguri', 'Solapur',
  'Srinagar', 'Surat', 'Thane', 'Thiruvananthapuram', 'Thrissur', 'Tiruchirappalli',
  'Tirunelveli', 'Tirupati', 'Tiruppur', 'Udaipur', 'Ujjain', 'Vadodara', 'Varanasi',
  'Vasai-Virar', 'Vijayawada', 'Visakhapatnam', 'Warangal',
  // Frequently visited abroad
  'Abu Dhabi', 'Amsterdam', 'Auckland', 'Bangkok', 'Barcelona', 'Beijing', 'Berlin', 'Boston',
  'Brisbane', 'Brussels', 'Cairo', 'Cape Town', 'Chicago', 'Colombo', 'Copenhagen', 'Dallas',
  'Dhaka', 'Doha', 'Dubai', 'Dublin', 'Frankfurt', 'Geneva', 'Hanoi', 'Helsinki', 'Ho Chi Minh City',
  'Hong Kong', 'Istanbul', 'Jakarta', 'Johannesburg', 'Kathmandu', 'Kuala Lumpur', 'Kuwait City',
  'Lisbon', 'London', 'Los Angeles', 'Madrid', 'Manila', 'Melbourne', 'Mexico City', 'Milan',
  'Montreal', 'Moscow', 'Muscat', 'Nairobi', 'New York', 'Osaka', 'Oslo', 'Paris', 'Prague',
  'Riyadh', 'Rome', 'San Francisco', 'Sao Paulo', 'Seattle', 'Seoul', 'Shanghai', 'Singapore',
  'Stockholm', 'Sydney', 'Taipei', 'Tel Aviv', 'Tokyo', 'Toronto', 'Vancouver', 'Vienna',
  'Warsaw', 'Washington DC', 'Zurich',
];
