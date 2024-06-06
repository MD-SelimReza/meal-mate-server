const express = require('express');
const app = express();
require('dotenv').config();
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)

const port = process.env.PORT || 9000;

const corsOptions = {
    origin: ['http://localhost:5173', 'http://localhost:5174'],
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
        const mealCollection = client.db('hostelDB').collection('meals');
        const packageCollection = client.db('hostelDB').collection('packages');
        const userCollection = client.db('hostelDB').collection('users');
        const paymentCollection = client.db('hostelDB').collection('payments');


        // middlewares
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

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await userCollection.findOne(query);
            const isAdmin = user?.badge === 'admin';
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
            console.log('Price--->', price);
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
            console.log('payment info', payment);

            res.send({ paymentResult });
        })

        // meals api
        app.get('/meals', async (req, res) => {
            const page = parseInt(req.query.page) || 1;
            const limit = parseInt(req.query.limit) || 10;
            const skip = (page - 1) * limit;

            try {
                const meals = await mealCollection.find().skip(skip).limit(limit).toArray();
                const totalMeals = await mealCollection.countDocuments();

                res.send({
                    meals,
                    totalMeals,
                    currentPage: page,
                    totalPages: Math.ceil(totalMeals / limit),
                    nextPage: page * limit < totalMeals ? page + 1 : null
                });
            } catch (error) {
                res.status(500).send({ error: 'Failed to fetch meals...' });
            }
        });

        app.get('/meal/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await mealCollection.findOne(query);
            res.send(result);
        })

        // users api
        app.post('/user', async (req, res) => {
            const user = req.body;
            console.log('user-->', user);
            const query = { email: user?.email };
            console.log('user email-->', query);
            const existingUser = await userCollection.findOne(query);
            if (existingUser) {
                return res.send(existingUser);
            }
            const result = await userCollection.insertOne(user);
            res.send(result);
        })

        app.get('/user/:email', async (req, res) => {
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
            console.log('has user-->', user);
            let admin = false;
            if (user) {
                admin = user?.badge === 'Admin';
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



