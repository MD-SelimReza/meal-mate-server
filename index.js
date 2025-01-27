const express = require('express');
const app = express();
require('dotenv').config();
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)

const port = process.env.PORT || 9000;

const corsOptions = {
    origin: ['http://localhost:5173', 'http://localhost:5174', "https://hostel-server-omega.vercel.app", "https://hostel-management-d32e5.web.app"],
    credentials: true,
    optionSuccessStatus: 200,
}

app.use(cors(corsOptions));
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.4ldhpeq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Collection
        const mealCollection = client.db('hostelDB').collection('mealsdata');
        const requestedMealCollection = client.db('hostelDB').collection('requestMeals');
        const packageCollection = client.db('hostelDB').collection('packages');
        const userCollection = client.db('hostelDB').collection('users');
        const paymentCollection = client.db('hostelDB').collection('payments');

        // middlewares
        // token verify
        const verifyToken = (req, res, next) => {
            console.log('inside verify token', req.headers.authorization);
            if (!req.headers.authorization) {
                return res.status(401).send({ message: 'unauthorized access1' });
            }
            const token = req.headers.authorization.split(' ')[1];
            jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: 'unauthorized access2' });
                }
                req.decoded = decoded;
                next();
            })
        }

        // admin verify
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isAdmin = user?.role === 'Admin';
            console.log(user?.role);
            if (!isAdmin) {
                return res.status(403).send({ message: 'forbidden access' });
            }
            next();
        }

        // jwt api
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            console.log('User--->', user);
            const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1d' });
            console.log('Token--->', token);
            res.send({ token: token });
        })

        // payment api
        app.post('/create-payment-intent', async (req, res) => {
            const { price } = req.body;
            const amount = parseInt(price * 100);

            const paymentIntent = await stripe.paymentIntents.create({
                amount: amount,
                currency: 'usd',
                payment_method_types: ['card']
            })
            res.send({
                clientSecret: paymentIntent.client_secret
            })
        })

        app.post('/payments', async (req, res) => {
            const payment = req.body;
            const paymentResult = await paymentCollection.insertOne(payment);
            res.send({ paymentResult });
        })

        app.get('/payments/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const result = await paymentCollection.find(query).toArray();
            res.send(result);
        })

        // meals api
        // infinite scroller api
        app.post('/meals', verifyToken, verifyAdmin, async (req, res) => {
            const mealData = req.body;
            const result = await mealCollection.insertOne(mealData);
            res.send(result);
        })

        app.post('/meals/:id/reviews', verifyToken, async (req, res) => {
            const mealId = req.params.id;
            const newReview = req.body;
            const query = { _id: new ObjectId(mealId) };
            const updateDoc = {
                $push: { reviews: newReview }
            };

            const result = await mealCollection.updateOne(query, updateDoc);
            res.send(result);
        });

        app.get('/meals/:email/reviews', async (req, res) => {
            const email = req.params.email;

            const allMeals = await mealCollection.find({}).toArray();

            const allReviews = allMeals.reduce((acc, meal) => {
                if (Array.isArray(meal.reviews)) {
                    return [...acc, ...meal.reviews];
                }
                return acc;
            }, []);

            const userReviews = allReviews.filter(review => review?.email === email);
            res.send(userReviews);
        });

        app.delete('/review/delete/:id', async (req, res) => {
            const id = req.params.id;
            console.log('delete id-->', id);
            const query = { _id: new ObjectId(id) };
            const result = await mealCollection.deleteOne(query);
            res.send(result);
        })

        app.get('/meals', async (req, res) => {
            const page = parseInt(req.query.page) - 1;
            const limit = parseInt(req.query.size);
            const skip = page * limit;

            const sort = req.query.sort;

            let sortOptions = {};
            if (sort === 'likes_asc') {
                sortOptions = { likes: 1 };
            } else if (sort === 'likes_desc') {
                sortOptions = { likes: -1 };
            } else if (sort === 'reviews_asc') {
                sortOptions = { reviews: 1 };
            } else if (sort === 'reviews_desc') {
                sortOptions = { reviews: -1 };
            }

            try {
                const items = await mealCollection.find().sort(sortOptions).skip(skip).limit(limit).toArray();
                const totalMeals = await mealCollection.countDocuments();

                res.send({
                    items,
                    totalMeals,
                    currentPage: page,
                    totalPages: Math.ceil(totalMeals / limit),
                    nextPage: page * limit < totalMeals ? page + 1 : null
                });
            } catch (error) {
                res.status(500).send({ error: 'Failed to fetch meals...' });
            }
        });

        app.get('/all-meals', async (req, res) => {
            const filter = req.query.filter;
            const sort = req.query.sort;
            const search = req.query.search;

            let query = {
                $or: [
                    { category: { $regex: search, $options: 'i' } },
                    { title: { $regex: search, $options: 'i' } },
                ]
            };

            if (filter) query = { ...query, category: filter };

            let options = {};
            if (sort) options = { sort: { price: sort === 'asc' ? 1 : -1 } };
            const result = await mealCollection.find(query, options).toArray();

            res.send(result,);
        });

        app.get('/meal/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await mealCollection.findOne(query);
            res.send(result);
        })

        app.delete('/meal/delete/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await mealCollection.deleteOne(query);
            res.send(result);
        })

        app.put('/like-meal/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };

            const getMeal = await mealCollection.findOne(query);

            const currentLikes = getMeal.likes || 0;
            const newLikes = currentLikes + (getMeal.liked ? -1 : 1);

            const updateDoc = {
                $set: { likes: newLikes, liked: !getMeal.liked }
            };
            const result = await mealCollection.updateOne(query, updateDoc);
            console.log('Update result:', result);
        });

        // route save request meal in db
        app.post('/request/meal', async (req, res) => {
            const requestMeal = req.body;
            const query = {
                requestedId: requestMeal?.requestedId
            };
            const alreadyRequest = await requestedMealCollection.findOne(query);
            if (alreadyRequest) {
                return res.send(`${requestMeal?.title} has already been added to the basket!`);
            }
            delete requestMeal._id;
            const result = await requestedMealCollection.insertOne(requestMeal);

            res.send(result);
        })

        app.get('/request/:email', async (req, res) => {
            const page = parseInt(req.query.page) - 1;
            const limit = parseInt(req.query.size);
            const skip = page * limit;
            const email = req.params.email;
            const query = { userEmail: email };
            const meals = await requestedMealCollection.find(query).skip(skip).limit(limit).toArray();
            const totalMeals = await requestedMealCollection.countDocuments();

            res.send({
                meals,
                totalMeals,
                currentPage: page,
                totalPages: Math.ceil(totalMeals / limit),
                nextPage: page * limit < totalMeals ? page + 1 : null
            });
        })

        app.get('/request-meals', async (req, res) => {
            const page = parseInt(req.query.page) - 1;
            const limit = parseInt(req.query.size);
            const skip = page * limit;
            const search = req.query.search;

            let query = {
                $or: [
                    { category: { $regex: search, $options: 'i' } },
                    { title: { $regex: search, $options: 'i' } },
                ]
            };

            try {
                const items = await requestedMealCollection.find(query).skip(skip).limit(limit).toArray();
                const totalMeals = await requestedMealCollection.countDocuments();

                res.send({
                    items,
                    totalMeals,
                    currentPage: page,
                    totalPages: Math.ceil(totalMeals / limit),
                    nextPage: page * limit < totalMeals ? page + 1 : null
                });
            } catch (error) {
                res.status(500).send({ error: 'Failed to fetch meals...' });
            }
        });

        app.patch('/meal/delivered/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const meal = req.body;
            console.log(meal);
            const query = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: { ...meal },
            }
            const result = await requestedMealCollection.updateOne(query, updateDoc)
            res.send(result)
        })

        app.delete('/request-meal/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await requestedMealCollection.deleteOne(query);
            res.send(result);
        })

        app.get('/upcoming-meals', async (req, res) => {
            const result = await mealCollection.find().toArray();
            res.send(result);
        })

        app.get('/upcoming/meals', async (req, res) => {
            const sortOptions = { likes: -1 }; // Sort by likes in descending order

            const result = await mealCollection.find().sort(sortOptions).toArray();

            res.send(result);
        })

        // users api
        app.post('/user', async (req, res) => {
            const user = req.body;
            console.log(user);
            const query = { email: user?.email };
            const existingUser = await userCollection.findOne(query);
            if (existingUser) {
                return res.send(existingUser);
            }
            const result = await userCollection.insertOne(user);
            res.send(result);
        })

        app.get('/users', async (req, res) => {
            const page = parseInt(req.query.page) - 1;
            const limit = parseInt(req.query.size);
            const skip = page * limit;
            const search = req.query.search;

            let query = {
                $or: [
                    { name: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } },
                ]
            };

            try {
                const items = await userCollection.find(query).skip(skip).limit(limit).toArray();
                const totalMeals = await userCollection.countDocuments();

                res.send({
                    items,
                    totalMeals,
                    currentPage: page,
                    totalPages: Math.ceil(totalMeals / limit),
                    nextPage: page * limit < totalMeals ? page + 1 : null
                });
            } catch (error) {
                res.status(500).send({ error: 'Failed to fetch meals...' });
            }
        });


        // Update a user badge
        app.patch('/user-badge/update/:email', verifyToken, async (req, res) => {
            const email = req.params.email
            const user = req.body
            const query = { email }
            const updateDoc = {
                $set: { ...user },
            }
            const result = await userCollection.updateOne(query, updateDoc)
            res.send(result)
        })

        app.get('/user/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const result = await userCollection.findOne(query);
            res.send(result);
        })

        app.get('/users/admin/:email', verifyToken, async (req, res) => {
            const email = req.params.email;
            console.log(email, req.decoded.email);
            if (!email === req.decoded.email) {
                return res.status(403).send({ message: 'unauthorized access3' });
            }
            const query = { email: email };
            const user = await userCollection.findOne(query);
            let admin = false;
            if (user) {
                admin = user?.role === 'Admin';
            }
            res.send({ admin });
        })

        // package api 
        app.get('/packages', async (req, res) => {
            const result = await packageCollection.find().toArray();
            res.send(result);
        })

        app.get('/checkout/:package_name', async (req, res) => {
            const package = req.params.package_name;
            console.log(package);
            const query = { package_name: package };
            const result = await packageCollection.findOne(query);
            res.send(result);
        })

        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);




app.get('/', (req, res) => {
    res.send('Server is running...');
});

app.listen(port, () => {
    console.log(`Server is running on port: ${port}`);
});



