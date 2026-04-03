import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Member } from "../models/member.model.js";
import { User } from "../models/user.model.js";
import mongoose from "mongoose";


const addMember = asyncHandler(async (req, res) => {
    const { name, age, gender, weight, height, relation, blood_group } = req.body;

    // 1. Validate required fields (based on your member.model.js)
    if (!name || !age || !gender || !weight || !height || !relation || !blood_group) {
        throw new ApiError(400, "All health profile fields are required");
    }

    // 2. Create the new member in the database
    const newMember = await Member.create({
        name,
        age,
        gender,
        weight,
        height,
        relation,
        blood_group
    });

    if (!newMember) {
        throw new ApiError(500, "Failed to create member");
    }

    // 3. Link the member to the currently logged-in User
    // We add the new member's ID to the user's `members` array
    const updatedUser = await User.findByIdAndUpdate(
        req.user._id,
        {
            $push: { members: newMember._id }
        },
        { returnDocument: 'after' }
    );

    if (!updatedUser) {
        throw new ApiError(500, "Failed to link member to user");
    }

    return res.status(201).json(
        new ApiResponse(201, "Member added successfully")
    );
});

export { addMember }

const getMembers = asyncHandler(async (req, res) => {
    // We use an Aggregation Pipeline to get the User and deeply fetch all their Members
    const userWithMembers = await User.aggregate([
        {
            // Step 1: Find the current user
            $match: {
                _id: new mongoose.Types.ObjectId(req.user._id)
            }
        },
        {
            // Step 2: Grab all Member documents whose IDs are in the user's `members` array
            $lookup: {
                from: "members", // Name of the collection in MongoDB
                localField: "members", // The array field in the User model
                foreignField: "_id", // The id field in the Member model
                as: "familyMembers" // What to call the resulting array
            }
        },
        {
            // Step 3: Only send back the data we actually need for security
            $project: {
                _id: 0,
                "familyMembers._id": 1,
                "familyMembers.name": 1,
                "familyMembers.age": 1,
                "familyMembers.gender": 1,
                "familyMembers.weight": 1,
                "familyMembers.height": 1,
                "familyMembers.relation": 1,
                "familyMembers.blood_group": 1
            }
        }
    ]);

    if (!userWithMembers || userWithMembers.length === 0) {
        throw new ApiError(404, "User not found");
    }

    // `userWithMembers` is an array of size 1, so we return the first element
    return res.status(200).json(
        new ApiResponse(200, "Members fetched successfully", userWithMembers[0].familyMembers)
    );
});

export { getMembers }

const deleteMember = asyncHandler(async (req, res) => {
    const { _id } = req.body;


    const member = await Member.findById(_id);
    if (!member) {
        throw new ApiError(404, "Member not found");
    }

    const updatedUser = await User.findByIdAndUpdate(
        req.user._id,
        {
            $pull: { members: _id }
        },
        { returnDocument: 'after' }
    );

    if (!updatedUser) {
        throw new ApiError(500, "Failed to remove member from user profile");
    }

    await Member.findByIdAndDelete(_id);

    return res.status(200).json(
        new ApiResponse(200, "Member deleted successfully")
    );
});

export { deleteMember }


const updateMember = asyncHandler(
    async (req, res) => {
        const { _id, name, age, gender, weight, height, relation, blood_group } = req.body;

        if (!_id) {
            throw new ApiError(400, "Member ID is required");
        }

        const updateFields = {};
        if (name) updateFields.name = name;
        if (age) updateFields.age = age;
        if (gender) updateFields.gender = gender;
        if (weight) updateFields.weight = weight;
        if (height) updateFields.height = height;
        if (relation) updateFields.relation = relation;
        if (blood_group) updateFields.blood_group = blood_group;


        // Use the Model (Member) to find and update, not the instance
        const updatedMember = await Member.findByIdAndUpdate(
            _id,
            {
                $set: updateFields
            },
            {
                returnDocument: 'after' // returns the newly updated document
            }
        );

        if (!updatedMember) {
            throw new ApiError(404, "Member not found or could not be updated");
        }

        return res.status(200).json(
            new ApiResponse(200, "Member updated successfully")
        );
    }
)

export { updateMember }



