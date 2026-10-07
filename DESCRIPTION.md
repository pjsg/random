This is a web app that runs entirely client side. The idea is to have a random number generator that can be configured in lots of different ways. Each configuration will be saved locally and then can be instantiated and used.

A configuration includes a name and one or more "fields". Each field is a random generator and is configured with the following information:

* If numeric, what is the range of values
* If not numeric, then what is the set of values -- e.g. Blue, Red, Green, Orange

One or more fields can be grouped together to make a 'without replacement' group -- i.e. a combination of values will never be repeated.

The state of the 'without replacement' field will be saved between browser sessions.

It should be possible to import a configuration from a URL (with the config in JSON)

When pressing the 'Generate' button, the output fields should get a cool animation before taking a second to stabilize. 